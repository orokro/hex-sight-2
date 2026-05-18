/*
 * main.js
 * Entry point. Spins up the Three.js scene, loads the GLB and VRM
 * avatars plus a Mixamo "without skin" FBX animation in parallel, then
 * retargets the Mixamo clip onto the VRM and plays it back. UI lets the
 * user pick which avatar is shown and toggle the animation on/off.
 */

import * as THREE from 'three';
import { createScene } from './scene.js';
import { loadGLB, loadVRM, loadFBXAnimation } from './avatar-loader.js';
import { retargetMixamoToVRM, MIXAMO_TO_VRM } from './retarget.js';

const GLB_URL = '/models/avatar.glb';
const VRM_URL = '/models/avatar.vrm';
const FBX_URL = '/animations/Hip Hop Dancing.fbx';

/**
 * @typedef {import('./avatar-loader.js').AvatarHandle} AvatarHandle
 */

const container = document.getElementById('app');
const handle = createScene(container);

const statusEl = document.getElementById('status');
const btnGlb = document.getElementById('btn-glb');
const btnVrm = document.getElementById('btn-vrm');
const btnBoth = document.getElementById('btn-both');
const btnPlay = document.getElementById('btn-play');

/** @type {{ glb: AvatarHandle | null, vrm: AvatarHandle | null }} */
const avatars = { glb: null, vrm: null };

/** @type {Map<AvatarHandle, () => void>} */
const updateUnregistrars = new Map();

/** @type {THREE.AnimationMixer | null} */
let danceMixer = null;
/** @type {THREE.AnimationAction | null} */
let danceAction = null;
/** Unregister fn for the mixer's per-frame tick. */
let danceTickUnregister = null;
let dancePlaying = false;

/** Diagnostic: a normalized bone we'll watch each frame when playing. */
let watchBone = null;
let watchTickCount = 0;

/**
 * Add an avatar to the scene at the given x offset and start its per-frame
 * update hook.
 * @param {AvatarHandle} avatar
 * @param {number} xOffset
 */
function attach(avatar, xOffset) {
	avatar.root.position.x = xOffset;
	handle.scene.add(avatar.root);
	const unregister = handle.onUpdate((dt) => avatar.update(dt));
	updateUnregistrars.set(avatar, unregister);
}

/**
 * Remove an avatar from the scene and stop its update loop. Does not
 * dispose its GPU resources — the avatar can be re-attached later.
 * @param {AvatarHandle} avatar
 */
function detach(avatar) {
	handle.scene.remove(avatar.root);
	const unregister = updateUnregistrars.get(avatar);
	if (unregister) {
		unregister();
		updateUnregistrars.delete(avatar);
	}
}

/**
 * Switch to one of three view modes.
 * @param {'glb' | 'vrm' | 'both'} mode
 */
function setMode(mode) {
	if (avatars.glb) detach(avatars.glb);
	if (avatars.vrm) detach(avatars.vrm);

	if (mode === 'glb' && avatars.glb) {
		attach(avatars.glb, 0);
	} else if (mode === 'vrm' && avatars.vrm) {
		attach(avatars.vrm, 0);
	} else if (mode === 'both') {
		if (avatars.glb) attach(avatars.glb, -0.6);
		if (avatars.vrm) attach(avatars.vrm, 0.6);
	}

	for (const b of [btnGlb, btnVrm, btnBoth]) b.classList.remove('active');
	({ glb: btnGlb, vrm: btnVrm, both: btnBoth })[mode].classList.add('active');
}

/**
 * Build the AnimationMixer/Action pair for the dance clip on the VRM.
 * Idempotent: safe to call once both VRM and the clip are available.
 *
 * @param {AvatarHandle} vrmAvatar
 * @param {THREE.AnimationClip} clip
 */
function setupDance(vrmAvatar, clip) {
	if (!vrmAvatar.vrm) return;
	danceMixer = new THREE.AnimationMixer(vrmAvatar.root);
	danceAction = danceMixer.clipAction(clip);
	danceAction.setLoop(THREE.LoopRepeat, Infinity);
}

/**
 * Toggle the dance animation on or off. Manages its per-frame tick
 * registration so we don't pay for a mixer.update when nothing's playing.
 */
function toggleDance() {
	if (!danceAction) {
		console.warn('[dance] toggle pressed but danceAction is null');
		return;
	}

	if (dancePlaying) {
		danceAction.stop();
		if (danceTickUnregister) {
			danceTickUnregister();
			danceTickUnregister = null;
		}
		dancePlaying = false;
		btnPlay.textContent = 'Play';
		btnPlay.classList.remove('active');
		console.log('[dance] stopped');
	} else {
		danceAction.reset().play();
		watchTickCount = 0;
		danceTickUnregister = handle.onUpdate((dt) => {
			danceMixer.update(dt);
			// Sample a watched bone every ~30 frames so the user can see
			// (in the console) whether quaternion writes are landing.
			if (watchBone && (watchTickCount++ % 30 === 0)) {
				const q = watchBone.quaternion;
				console.log(
					`[dance] tick ${watchTickCount} t=${danceAction.time.toFixed(2)}s`,
					`${watchBone.name}.q=(${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)},${q.w.toFixed(3)})`
				);
			}
		});
		dancePlaying = true;
		btnPlay.textContent = 'Stop';
		btnPlay.classList.add('active');
		console.log('[dance] play; action.time =', danceAction.time, 'enabled =', danceAction.enabled, 'weight =', danceAction.getEffectiveWeight());
	}
}

btnGlb.addEventListener('click', () => setMode('glb'));
btnVrm.addEventListener('click', () => setMode('vrm'));
btnBoth.addEventListener('click', () => setMode('both'));
btnPlay.addEventListener('click', toggleDance);

/**
 * Walk vrm.scene and bucket descendant names by Normalized_/raw/other so
 * we can verify the normalized humanoid is actually present and reachable.
 * @param {AvatarHandle} vrmAvatar
 */
function diagnoseScene(vrmAvatar) {
	const names = [];
	vrmAvatar.root.traverse((o) => { if (o.name) names.push(o.name); });
	const normalized = names.filter((n) => n.startsWith('Normalized_'));
	console.log('[diag] vrm.scene descendants total:', names.length, 'normalized:', normalized.length);
	console.log('[diag] sample normalized:', normalized.slice(0, 6));

	// Try the resolved hip bone — pick a strong landmark to watch.
	const hipsNorm = vrmAvatar.vrm.humanoid?.getNormalizedBoneNode?.('hips');
	const leftUpperArmNorm = vrmAvatar.vrm.humanoid?.getNormalizedBoneNode?.('leftUpperArm');
	console.log('[diag] normalized hips node name:', hipsNorm?.name);
	console.log('[diag] normalized leftUpperArm node name:', leftUpperArmNorm?.name);

	// Verify each is reachable from vrm.scene by name lookup.
	if (hipsNorm) {
		const found = vrmAvatar.root.getObjectByName(hipsNorm.name);
		console.log('[diag] hips reachable by name from vrm.scene?', found === hipsNorm);
	}
	watchBone = leftUpperArmNorm ?? hipsNorm ?? null;
	console.log('[diag] will watch bone:', watchBone?.name);
}

/**
 * Inspect a retargeted clip and log what we'd expect AnimationMixer to bind.
 * @param {THREE.AnimationClip} clip
 */
function diagnoseClip(clip) {
	console.log('[diag] retargeted clip:', clip.name, 'duration:', clip.duration, 'tracks:', clip.tracks.length);
	console.log('[diag] track names sample:', clip.tracks.slice(0, 6).map((t) => t.name));
}

/**
 * Kick off all three loads in parallel, then wire up retargeting if both
 * the VRM and the FBX clip arrived successfully.
 */
async function init() {
	statusEl.textContent = 'Loading avatars + animation…';

	const [glbRes, vrmRes, fbxRes] = await Promise.allSettled([
		loadGLB(GLB_URL),
		loadVRM(VRM_URL),
		loadFBXAnimation(FBX_URL),
	]);

	if (glbRes.status === 'fulfilled') {
		avatars.glb = glbRes.value;
	} else {
		console.error('GLB load failed:', glbRes.reason);
	}
	if (vrmRes.status === 'fulfilled') {
		avatars.vrm = vrmRes.value;
	} else {
		console.error('VRM load failed:', vrmRes.reason);
	}

	let fbxBundle = null;
	if (fbxRes.status === 'fulfilled') {
		fbxBundle = fbxRes.value;
	} else {
		console.error('FBX load failed:', fbxRes.reason);
	}

	// Expose for poking from the console.
	window.app = { handle, avatars, fbxBundle, MIXAMO_TO_VRM };

	if (avatars.vrm) diagnoseScene(avatars.vrm);

	if (avatars.vrm && fbxBundle && fbxBundle.clips.length > 0) {
		try {
			const retargeted = retargetMixamoToVRM(
				fbxBundle.clips[0],
				fbxBundle.root,
				avatars.vrm.vrm
			);
			diagnoseClip(retargeted);
			setupDance(avatars.vrm, retargeted);
			window.app.retargetedClip = retargeted;
			window.app.danceMixer = danceMixer;
			window.app.danceAction = danceAction;
			btnPlay.disabled = false;
		} catch (e) {
			console.error('Retargeting failed:', e);
		}
	}

	const parts = [];
	parts.push(avatars.glb ? 'GLB ✓' : 'GLB ✗');
	parts.push(avatars.vrm ? 'VRM ✓' : 'VRM ✗');
	parts.push(fbxBundle ? `anim ✓ (${fbxBundle.clips.length} clip${fbxBundle.clips.length === 1 ? '' : 's'})` : 'anim ✗');
	if (danceAction) {
		const n = window.app.retargetedClip?.tracks.length ?? 0;
		parts.push(`retargeted ✓ (${n} tracks)`);
	}
	statusEl.textContent = parts.join(' · ');

	if (avatars.vrm) setMode('vrm');
	else if (avatars.glb) setMode('glb');
}

init();
