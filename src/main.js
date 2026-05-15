/*
 * main.js
 * Entry point. Spins up the Three.js scene, loads both avatar variants
 * (GLB and VRM), and wires up a tiny in-page UI to toggle between them.
 * This is the first-pass demo for getting a VRoid avatar rendering in
 * the project before we layer on hex-game logic.
 */

import { createScene } from './scene.js';
import { loadGLB, loadVRM } from './avatar-loader.js';

const GLB_URL = '/models/avatar.glb';
const VRM_URL = '/models/avatar.vrm';

/**
 * @typedef {import('./avatar-loader.js').AvatarHandle} AvatarHandle
 */

const container = document.getElementById('app');
const handle = createScene(container);

const statusEl = document.getElementById('status');
const btnGlb = document.getElementById('btn-glb');
const btnVrm = document.getElementById('btn-vrm');
const btnBoth = document.getElementById('btn-both');

/** @type {{ glb: AvatarHandle | null, vrm: AvatarHandle | null }} */
const avatars = { glb: null, vrm: null };

/** @type {Map<AvatarHandle, () => void>} */
const updateUnregistrars = new Map();

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

btnGlb.addEventListener('click', () => setMode('glb'));
btnVrm.addEventListener('click', () => setMode('vrm'));
btnBoth.addEventListener('click', () => setMode('both'));

/**
 * Kick off both loads in parallel, then show whichever finished. We don't
 * block on both — if one fails we still want to see the other.
 */
async function init() {
	statusEl.textContent = 'Loading avatars...';

	const [glbRes, vrmRes] = await Promise.allSettled([
		loadGLB(GLB_URL),
		loadVRM(VRM_URL),
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

	const parts = [];
	if (avatars.glb) parts.push('GLB loaded');
	else parts.push('GLB FAILED (see console)');
	if (avatars.vrm) parts.push('VRM loaded');
	else parts.push('VRM FAILED (see console)');
	statusEl.textContent = parts.join(' · ');

	// Default view: whichever loaded first, prefer VRM (it's the goal).
	if (avatars.vrm) setMode('vrm');
	else if (avatars.glb) setMode('glb');
}

init();
