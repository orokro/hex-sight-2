/*
 * avatar-loader.js
 * Loaders for GLB (plain glTF binary) and VRM (VRoid-style avatar)
 * assets. The VRM loader uses @pixiv/three-vrm via GLTFLoader's plugin
 * mechanism. Both functions return a normalized handle so the caller can
 * treat them interchangeably for scene attachment and per-frame updates.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * @typedef {Object} AvatarHandle
 * @property {'glb' | 'vrm'} kind
 * @property {THREE.Object3D} root        Root Object3D you can add to a scene.
 * @property {import('@pixiv/three-vrm').VRM | null} vrm  Non-null for VRM avatars.
 * @property {(dt: number) => void} update  Per-frame update hook.
 * @property {() => void} dispose          Tear-down — geometry/material/textures.
 */

/**
 * Make every mesh under `root` cast + receive shadows. Cheap pass we apply
 * to both loader paths so the demo scene is consistent.
 * @param {THREE.Object3D} root
 */
function enableShadows(root) {
	root.traverse((obj) => {
		if (obj.isMesh) {
			obj.castShadow = true;
			obj.receiveShadow = true;
		}
	});
}

/**
 * Recursively dispose geometries, materials, and textures under a root.
 * @param {THREE.Object3D} root
 */
function disposeTree(root) {
	root.traverse((obj) => {
		if (obj.isMesh) {
			obj.geometry?.dispose?.();
			const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
			for (const m of mats) {
				if (!m) continue;
				for (const key of Object.keys(m)) {
					const v = m[key];
					if (v && v.isTexture) v.dispose();
				}
				m.dispose?.();
			}
		}
	});
}

/**
 * Load a plain GLB file.
 * @param {string} url
 * @returns {Promise<AvatarHandle>}
 */
export async function loadGLB(url) {
	const loader = new GLTFLoader();
	const gltf = await loader.loadAsync(url);
	const root = gltf.scene;
	enableShadows(root);

	const mixer = new THREE.AnimationMixer(root);
	const clips = gltf.animations ?? [];
	for (const clip of clips) mixer.clipAction(clip).play();

	return {
		kind: 'glb',
		root,
		vrm: null,
		update: (dt) => mixer.update(dt),
		dispose: () => {
			mixer.stopAllAction();
			disposeTree(root);
		},
	};
}

/**
 * Load a VRM file using @pixiv/three-vrm.
 * @param {string} url
 * @returns {Promise<AvatarHandle>}
 */
export async function loadVRM(url) {
	const loader = new GLTFLoader();
	loader.register((parser) => new VRMLoaderPlugin(parser));

	const gltf = await loader.loadAsync(url);
	/** @type {import('@pixiv/three-vrm').VRM} */
	const vrm = gltf.userData.vrm;

	// Recommended cleanup passes from the three-vrm docs.
	VRMUtils.removeUnnecessaryVertices(gltf.scene);
	VRMUtils.combineSkeletons(gltf.scene);

	// VRM0 models face +Z; VRM1 faces -Z. Rotate VRM0 so both load
	// consistently facing the camera (+Z toward viewer in our setup).
	if (vrm.meta?.metaVersion === '0') {
		VRMUtils.rotateVRM0(vrm);
	}

	enableShadows(vrm.scene);

	return {
		kind: 'vrm',
		root: vrm.scene,
		vrm,
		update: (dt) => vrm.update(dt),
		dispose: () => {
			VRMUtils.deepDispose(vrm.scene);
		},
	};
}
