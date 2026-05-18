/*
 * retarget.js
 * First-pass Mixamo -> VRM animation retargeting.
 *
 * Strategy: produce a brand-new AnimationClip whose tracks reference VRM
 * bone node names instead of Mixamo bone names, with each quaternion
 * value corrected for the rest-pose difference between the two rigs
 * (Mixamo is T-pose, VRoid is A-pose).
 *
 * For each quaternion track on a Mixamo bone we compute:
 *
 *     q_new = q_target_rest * (q_source_rest^-1 * q_source_anim)
 *
 * which is "take the source bone's rotation delta from its own rest pose
 * and apply that delta to the target bone's rest pose." When the target
 * is a *normalized* VRM bone (see resolveVRMTargets) its rest rotation is
 * identity, so this simplifies to q_new = q_source_rest^-1 * q_source_anim.
 *
 * IMPORTANT: we target normalized bones rather than the raw VRM bones,
 * because three-vrm's autoUpdateHumanBones overwrites raw transforms on
 * every vrm.update(). The normalized rig (named "Normalized_<rawName>",
 * parented under humanoid.normalizedHumanBonesRoot which the loader adds
 * to vrm.scene) is the writeable layer; humanoid.update() then copies
 * those poses into the raw skeleton with bind-pose math applied.
 *
 * NAME NORMALIZATION: three's FBXLoader runs bone/track names through
 * PropertyBinding.sanitizeNodeName(), which strips reserved chars
 * including the colon. So "mixamorig:Hips" arrives as "mixamorigHips".
 * We strip colons before lookup so both forms work.
 *
 * The hip translation track is scaled because Mixamo FBX positions come
 * out in centimeters whereas the VRM lives in meters; the scale is also
 * a knob to compensate for height differences between rigs.
 */

import * as THREE from 'three';

/**
 * Static mapping from canonical Mixamo bone names to VRM humanoid bone
 * names. Keys are written with the colon for human readability; lookup
 * happens via stripColon() so the loader's sanitized names also match.
 * Fingers omitted on this pass — see file header.
 */
export const MIXAMO_TO_VRM = {
	'mixamorig:Hips': 'hips',
	'mixamorig:Spine': 'spine',
	'mixamorig:Spine1': 'chest',
	'mixamorig:Spine2': 'upperChest',
	'mixamorig:Neck': 'neck',
	'mixamorig:Head': 'head',
	'mixamorig:LeftShoulder': 'leftShoulder',
	'mixamorig:LeftArm': 'leftUpperArm',
	'mixamorig:LeftForeArm': 'leftLowerArm',
	'mixamorig:LeftHand': 'leftHand',
	'mixamorig:RightShoulder': 'rightShoulder',
	'mixamorig:RightArm': 'rightUpperArm',
	'mixamorig:RightForeArm': 'rightLowerArm',
	'mixamorig:RightHand': 'rightHand',
	'mixamorig:LeftUpLeg': 'leftUpperLeg',
	'mixamorig:LeftLeg': 'leftLowerLeg',
	'mixamorig:LeftFoot': 'leftFoot',
	'mixamorig:LeftToeBase': 'leftToes',
	'mixamorig:RightUpLeg': 'rightUpperLeg',
	'mixamorig:RightLeg': 'rightLowerLeg',
	'mixamorig:RightFoot': 'rightFoot',
	'mixamorig:RightToeBase': 'rightToes',
};

/**
 * Strip colon from a bone name. three's FBXLoader sanitizes node and
 * track names by removing reserved chars including ':' — so the bone
 * named "mixamorig:Hips" in the source FBX comes out as "mixamorigHips"
 * in both the scene graph and the animation tracks. Calling this on
 * both sides of the comparison makes the lookup loader-version agnostic.
 *
 * @param {string} name
 * @returns {string}
 */
function stripColon(name) {
	return name.replace(/:/g, '');
}

/** Pre-built sanitized-key version of MIXAMO_TO_VRM for fast lookup. */
const MIXAMO_TO_VRM_SANITIZED = (() => {
	/** @type {Object<string, string>} */
	const out = {};
	for (const [k, v] of Object.entries(MIXAMO_TO_VRM)) out[stripColon(k)] = v;
	return out;
})();

/**
 * Walk the FBX hierarchy and collect rest-pose quaternions for every
 * mixamorig bone (with or without colon). Called once before any
 * animation is applied. Keys in the returned object are sanitized
 * (colon-stripped) so they match the track-name lookup below.
 *
 * @param {THREE.Object3D} sourceRoot
 * @returns {Object<string, THREE.Quaternion>}
 */
function captureSourceRest(sourceRoot) {
	/** @type {Object<string, THREE.Quaternion>} */
	const map = {};
	sourceRoot.traverse((obj) => {
		if (!obj.name) return;
		const key = stripColon(obj.name);
		if (key.startsWith('mixamorig')) {
			map[key] = obj.quaternion.clone();
		}
	});
	return map;
}

/**
 * Resolve the VRM-side target bone for each Mixamo bone name we know
 * about, plus its rest quaternion in parent-local space. Keys are
 * colon-stripped to match captureSourceRest / track-name lookup.
 *
 * Uses the *normalized* bone node (see file header for why).
 *
 * @param {import('@pixiv/three-vrm').VRM} vrm
 * @returns {Object<string, { node: THREE.Object3D, restQuat: THREE.Quaternion }>}
 */
function resolveVRMTargets(vrm) {
	/** @type {Object<string, { node: THREE.Object3D, restQuat: THREE.Quaternion }>} */
	const out = {};
	const humanoid = vrm.humanoid;
	if (!humanoid) return out;

	for (const [sanitizedMixName, vrmName] of Object.entries(MIXAMO_TO_VRM_SANITIZED)) {
		const node = humanoid.getNormalizedBoneNode?.(vrmName);
		if (node) {
			out[sanitizedMixName] = {
				node,
				// Normalized bones rest at identity rotation by construction;
				// capturing keeps the math general in case that ever changes.
				restQuat: node.quaternion.clone(),
			};
		}
	}
	return out;
}

/**
 * Estimate a scale factor for the hip translation track. Mixamo FBX
 * positions are in centimeters; VRM lives in meters. The ratio of hip
 * world-Y at rest combines unit conversion and height matching.
 *
 * @param {THREE.Object3D} sourceRoot
 * @param {import('@pixiv/three-vrm').VRM} vrm
 * @returns {number}
 */
function estimateHipScale(sourceRoot, vrm) {
	// Find Mixamo hips by name with or without colon.
	let srcHips = sourceRoot.getObjectByName('mixamorig:Hips');
	if (!srcHips) srcHips = sourceRoot.getObjectByName('mixamorigHips');
	if (!srcHips) {
		sourceRoot.traverse((o) => {
			if (!srcHips && o.name && stripColon(o.name) === 'mixamorigHips') srcHips = o;
		});
	}
	const tgtHips =
		vrm.humanoid?.getNormalizedBoneNode?.('hips') ??
		vrm.humanoid?.getRawBoneNode?.('hips');
	if (!srcHips || !tgtHips) return 0.01;

	const srcWorld = new THREE.Vector3();
	const tgtWorld = new THREE.Vector3();
	srcHips.updateWorldMatrix(true, false);
	tgtHips.updateWorldMatrix(true, false);
	srcHips.getWorldPosition(srcWorld);
	tgtHips.getWorldPosition(tgtWorld);

	if (srcWorld.y > 0.0001) {
		return tgtWorld.y / srcWorld.y;
	}
	return 0.01;
}

/**
 * Retarget a Mixamo clip onto a VRM avatar.
 *
 * @param {THREE.AnimationClip} clip      Source clip from FBX.
 * @param {THREE.Object3D}      sourceRoot FBX scene root (must still be at rest pose).
 * @param {import('@pixiv/three-vrm').VRM} vrm
 * @param {Object} [opts]
 * @param {number} [opts.hipScale]  Override auto-detected hip translation scale.
 * @returns {THREE.AnimationClip}
 */
export function retargetMixamoToVRM(clip, sourceRoot, vrm, opts = {}) {
	const sourceRest = captureSourceRest(sourceRoot);
	const targetMap = resolveVRMTargets(vrm);
	const hipScale = opts.hipScale ?? estimateHipScale(sourceRoot, vrm);

	const _qSrc = new THREE.Quaternion();
	const _qDelta = new THREE.Quaternion();
	const _qOut = new THREE.Quaternion();

	const newTracks = [];
	const HIPS_KEY = 'mixamorigHips';

	for (const track of clip.tracks) {
		const dotIdx = track.name.lastIndexOf('.');
		if (dotIdx < 0) continue;
		const rawBoneName = track.name.slice(0, dotIdx);
		const prop = track.name.slice(dotIdx + 1);
		const boneName = stripColon(rawBoneName);

		const tgt = targetMap[boneName];
		if (!tgt) continue;

		if (prop === 'quaternion') {
			const srcRest = sourceRest[boneName];
			const tgtRest = tgt.restQuat;
			const newValues = new Float32Array(track.values.length);

			if (srcRest) {
				const srcRestInv = srcRest.clone().invert();
				for (let i = 0; i < track.values.length; i += 4) {
					_qSrc.set(
						track.values[i],
						track.values[i + 1],
						track.values[i + 2],
						track.values[i + 3]
					);
					// delta = q_source_rest^-1 * q_source_anim
					_qDelta.copy(srcRestInv).multiply(_qSrc);
					// q_new = q_target_rest * delta  (identity * delta for normalized bones)
					_qOut.copy(tgtRest).multiply(_qDelta);
					newValues[i] = _qOut.x;
					newValues[i + 1] = _qOut.y;
					newValues[i + 2] = _qOut.z;
					newValues[i + 3] = _qOut.w;
				}
			} else {
				newValues.set(track.values);
			}

			newTracks.push(
				new THREE.QuaternionKeyframeTrack(
					tgt.node.name + '.quaternion',
					new Float32Array(track.times),
					newValues
				)
			);
		} else if (prop === 'position' && boneName === HIPS_KEY) {
			const newValues = new Float32Array(track.values.length);
			for (let i = 0; i < track.values.length; i++) {
				newValues[i] = track.values[i] * hipScale;
			}
			newTracks.push(
				new THREE.VectorKeyframeTrack(
					tgt.node.name + '.position',
					new Float32Array(track.times),
					newValues
				)
			);
		}
		// All other tracks (scale, other-bone positions) are dropped.
	}

	return new THREE.AnimationClip(
		'retargeted_' + (clip.name || 'mixamo'),
		clip.duration,
		newTracks
	);
}
