/*
 * scene.js
 * Builds the Three.js renderer, scene, camera, lights, ground, and orbit
 * controls. Exposes a small handle other modules can use to register
 * per-frame update callbacks and add/remove objects from the scene.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * @typedef {Object} SceneHandle
 * @property {THREE.WebGLRenderer} renderer
 * @property {THREE.Scene}         scene
 * @property {THREE.PerspectiveCamera} camera
 * @property {OrbitControls}       controls
 * @property {THREE.Clock}         clock
 * @property {(cb: (dt: number) => void) => () => void} onUpdate
 *           Register a per-frame callback. Returns an unregister function.
 */

/**
 * Create the renderer/scene/camera/controls/lights/ground and start the
 * render loop. The caller can attach avatars to `handle.scene` and register
 * per-frame work via `handle.onUpdate`.
 *
 * @param {HTMLElement} container DOM element that will host the canvas.
 * @returns {SceneHandle}
 */
export function createScene(container) {
	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(container.clientWidth, container.clientHeight);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	container.appendChild(renderer.domElement);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x202428);

	const camera = new THREE.PerspectiveCamera(
		35,
		container.clientWidth / container.clientHeight,
		0.1,
		100
	);
	camera.position.set(0, 1.4, 3.0);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.target.set(0, 1.0, 0);
	controls.enableDamping = true;
	controls.update();

	// Lighting: hemisphere fill + directional key with shadows.
	const hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 0.6);
	scene.add(hemi);

	const key = new THREE.DirectionalLight(0xffffff, 1.4);
	key.position.set(2.5, 4.0, 2.0);
	key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048);
	key.shadow.camera.near = 0.5;
	key.shadow.camera.far = 20;
	key.shadow.camera.left = -3;
	key.shadow.camera.right = 3;
	key.shadow.camera.top = 4;
	key.shadow.camera.bottom = -1;
	key.shadow.bias = -0.0005;
	scene.add(key);

	// Ground plane (subtle, mainly to anchor shadow + scale).
	const ground = new THREE.Mesh(
		new THREE.CircleGeometry(4, 64),
		new THREE.MeshStandardMaterial({ color: 0x303338, roughness: 1.0 })
	);
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);

	// Grid for visual reference (1m squares).
	const grid = new THREE.GridHelper(8, 8, 0x555555, 0x3a3a3a);
	grid.position.y = 0.001;
	scene.add(grid);

	// Axes at origin to sanity-check avatar facing direction.
	const axes = new THREE.AxesHelper(0.5);
	scene.add(axes);

	const clock = new THREE.Clock();

	/** @type {Set<(dt: number) => void>} */
	const updateCallbacks = new Set();

	/**
	 * Register a per-frame update callback.
	 * @param {(dt: number) => void} cb
	 * @returns {() => void} Unregister function.
	 */
	function onUpdate(cb) {
		updateCallbacks.add(cb);
		return () => updateCallbacks.delete(cb);
	}

	function onResize() {
		const w = container.clientWidth;
		const h = container.clientHeight;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
	}
	window.addEventListener('resize', onResize);

	function tick() {
		const dt = clock.getDelta();
		controls.update();
		for (const cb of updateCallbacks) cb(dt);
		renderer.render(scene, camera);
		requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);

	return { renderer, scene, camera, controls, clock, onUpdate };
}
