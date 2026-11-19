import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { acquireCanvas, releaseCanvas } from "../effects/canvas-pool";
import { createPack, createPackGeometry, deformPack, resetPack, PACK_WIDTH as W, PACK_HEIGHT as H, PACK_CUT as CUT, type PackModel, type PackGeometry } from "./pack-model";

export interface PackSceneHandle { step: (direction: number) => void; spin: (direction: number) => void }
export interface PackBounds { left: number; top: number; width: number; height: number; seamY: number }
interface PackSceneProps {
  front: string;
  back: string;
  selected: number | null;
  tear: number;
  opening: boolean;
  reduced: boolean;
  paused: boolean;
  resetVersion: number;
  paintBottom?: number;
  controls: Ref<PackSceneHandle>;
  onSelect: (index: number) => void;
  onActive: (index: number) => void;
  onBounds: (bounds: PackBounds) => void;
  onPrepared: () => void;
  onReady: () => void;
  onOpened: () => void;
  onUnavailable: () => void;
}

// Five floating packs arranged around a reflected studio floor.
const PACK_SETTINGS = {
  count: 5, spacing: 1, depth: 0.82, fov: 28, shadow: 1, sparks: 1,
} as const;
const PACK_SPIN = { sensitivity: 2, response: 28, maxSpeed: 10, decay: 6 } as const;
const TAU = Math.PI * 2;
const FLOOR = -H / 2 - 0.17;
const stepAngle = TAU / PACK_SETTINGS.count;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const tangent = Math.tan(THREE.MathUtils.degToRad(PACK_SETTINGS.fov / 2));
type PackMotion = { yaw: number; targetYaw: number; pitch: number; targetPitch: number; velocity: number; hoverX: number; hoverY: number };
type Drag = {
  id: number; pack: number | null; hit: number | null; startX: number; startY: number;
  lastX: number; lastY: number; lastTime: number; moved: boolean; spinScale: number;
};

export default function PackScene(props: PackSceneProps) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const stepRef = useRef<(direction: number) => void>(() => {});
  const spinRef = useRef<(direction: number) => void>(() => {});
  useImperativeHandle(props.controls, () => ({ step: direction => stepRef.current(direction), spin: direction => spinRef.current(direction) }), []);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    let alive = true;
    let renderer: THREE.WebGLRenderer;
    const canvas = acquireCanvas("packs");
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      latest.current.onUnavailable();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    renderer.setClearColor(0xffffff, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    canvas.style.visibility = props.paused ? "hidden" : "";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    // Begin loading local textures before synchronous environment/shader
    // setup, allowing the network to run alongside that work.
    const textures = new Set<THREE.Texture>();
    const loader = new THREE.TextureLoader();
    const textureLoads = Promise.all([props.front, props.back].map(url => new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(url, texture => {
        if (!alive) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
        textures.add(texture);
        resolve(texture);
      }, undefined, reject);
    })));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(PACK_SETTINGS.fov, 1, 0.1, 80);
    camera.position.set(0, 0.3, 10.5);
    camera.lookAt(0, -0.05, 0);
    scene.environmentIntensity = 0.8;
    let environment: THREE.WebGLCubeRenderTarget | undefined;
    let packGeometry: PackGeometry | undefined;
    const ambient = new THREE.HemisphereLight(0xffffff, 0xb8bec8, 0.35);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.65);
    key.position.set(-3, 6, 9);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xe9efff, 0.45);
    rim.position.set(4, 1, -2);
    scene.add(rim);

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const packs: PackModel[] = [];
    const motions: PackMotion[] = Array.from({ length: PACK_SETTINGS.count }, () => ({ yaw: 0, targetYaw: 0, pitch: 0, targetPitch: 0, velocity: 0, hoverX: 0, hoverY: 0 }));
    const raycaster = new THREE.Raycaster();
    const point = new THREE.Vector2();
    const reflectionNormal = new THREE.Vector3();
    const reflectionView = new THREE.Vector3();
    let frame = 0, previous = 0, clock = 0;
    let angle = 0, targetAngle = 0, velocity = 0, selection = 0, detachment = 0;
    let openingTime = 0, opened = false;
    let active = 0, width = 1, height = 1, logicalHeight = 1, visible = true, loaded = false;
    let announced = false, prepared = false, shadersReady = false;
    const markShadersReady = () => {
      if (shadersReady) return;
      shadersReady = true;
      performance.mark("tcg:shaders-ready");
    };
    const markPrepared = () => {
      if (prepared) return;
      prepared = true;
      performance.mark("tcg:prepared");
      latest.current.onPrepared();
    };
    let hover: { index: number; x: number; y: number; face: number } | null = null;
    let drag: Drag | null = null;
    let lastBounds = "";
    let lastWheelAt = 0;
    let lastTear = -1;
    let lastSelected: number | null | undefined;
    let lastOpening = -1;
    let lastReset = props.resetVersion;

    const trackMaterials = (group: THREE.Group) => {
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
    };
    // Soft contact shadows stay on the studio floor beneath each floating pack.
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    gradient.addColorStop(0, "rgba(54,61,72,.34)");
    gradient.addColorStop(1, "rgba(65,74,85,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    textures.add(shadowTexture);
    const shadows = Array.from({ length: PACK_SETTINGS.count }, () => {
      const geometry = new THREE.PlaneGeometry(2.5, 1.2);
      const material = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false });
      geometries.add(geometry); materials.add(material);
      const shadow = new THREE.Mesh(geometry, material);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = FLOOR;
      scene.add(shadow);
      return shadow;
    });

    const flakeGeometry = new THREE.BufferGeometry();
    const flakePositions = new Float32Array(24 * 3);
    flakeGeometry.setAttribute("position", new THREE.BufferAttribute(flakePositions, 3));
    const flakeMaterial = new THREE.PointsMaterial({ color: "#ffffff", size: 0.035, transparent: true, depthWrite: false });
    const flakes = new THREE.Points(flakeGeometry, flakeMaterial);
    flakes.visible = false;
    scene.add(flakes);
    geometries.add(flakeGeometry);
    materials.add(flakeMaterial);

    let cancelPreparationFrame = () => {};
    // Yield between setup stages. A hidden document waits for visibility instead
    // of generating lighting, uploading textures or drawing a warm-up frame.
    const preparationFrame = () => new Promise<boolean>(resolve => {
      let pending = 0;
      const finish = (continuePreparing: boolean) => {
        cancelAnimationFrame(pending);
        document.removeEventListener("visibilitychange", schedule);
        cancelPreparationFrame = () => {};
        resolve(continuePreparing);
      };
      const schedule = () => {
        if (document.hidden) { cancelAnimationFrame(pending); pending = 0; return; }
        if (!pending) pending = requestAnimationFrame(() => finish(alive));
      };
      cancelPreparationFrame = () => finish(false);
      document.addEventListener("visibilitychange", schedule);
      schedule();
    });

    performance.mark("tcg:prepare-start");
    textureLoads.then(async ([front, back]) => {
      if (!alive || !(await preparationFrame())) return;
      performance.mark("tcg:textures-ready");
      packGeometry = createPackGeometry();
      for (let index = 0; index < PACK_SETTINGS.count; index++) {
        const pack = createPack(front, back, index, packGeometry);
        packs.push(pack);
        scene.add(pack.group, pack.reflection);
        trackMaterials(pack.group);
        trackMaterials(pack.reflection);
      }
      performance.mark("tcg:geometry-ready");
      if (!(await preparationFrame())) return;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      try { environment = pmrem.fromScene(room, 0.04); }
      finally { room.dispose(); pmrem.dispose(); }
      scene.environment = environment.texture;
      performance.mark("tcg:environment-ready");
      if (!(await preparationFrame())) return;
      renderer.initTexture(front);
      renderer.initTexture(back);
      if (latest.current.paused) {
        // compileAsync traverses invisible objects too. These proxies exclude
        // tear-only programs and share the real browsing geometry/materials.
        const browsingMeshes = new THREE.Group();
        scene.traverseVisible(object => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Points) browsingMeshes.add(object.clone(false));
        });
        await renderer.compileAsync(browsingMeshes, camera, scene);
        if (!alive || !(await preparationFrame())) return;
        markShadersReady();
        // Only a hidden carousel needs a warm-up draw. Active Cards uses its
        // first real frame directly, keeping precompilation off cold entry.
        if (latest.current.paused) {
          width = height = logicalHeight = 1;
          renderer.setSize(1, 1);
          renderer.render(scene, camera);
          markPrepared();
        }
      }
      loaded = true;
      resize();
    }).catch(() => { if (alive) latest.current.onUnavailable(); });

    function resize() {
      if (latest.current.paused) return;
      const rect = container!.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nextLogicalHeight = Math.max(1, rect.height - (latest.current.paintBottom ?? 0));
      if (width !== rect.width || height !== rect.height || logicalHeight !== nextLogicalHeight) {
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        logicalHeight = nextLogicalHeight;
        renderer.setSize(width, height);
        camera.aspect = width / logicalHeight;
        // Add drawing space below the original frustum without reframing packs.
        if (height > logicalHeight) camera.setViewOffset(width, logicalHeight, 0, 0, width, height);
        else camera.clearViewOffset();
        camera.updateProjectionMatrix();
        lastBounds = "";
      }
      wake();
    }

    function render(now: number) {
      frame = 0;
      if (!alive || !loaded || !visible || document.hidden || latest.current.paused) return;
      const dt = Math.min((now - previous) / 1000 || 1 / 60, 0.1);
      previous = now;
      const p = latest.current;
      const reduced = p.reduced;
      clock += dt;
      const selecting = p.selected !== null;
      if (selecting && lastSelected !== p.selected) { restoreSpins(); hover = null; }
      const smooth = 1 - Math.exp(-dt * 7);
      selection = reduced ? Number(selecting) : THREE.MathUtils.lerp(selection, Number(selecting), smooth);
      if (p.opening) openingTime += dt;
      else { openingTime = 0; opened = false; }
      detachment = p.opening ? (reduced ? 1 : clamp(openingTime / 0.45, 0, 1)) : 0;
      const aspect = width / logicalHeight;
      const mobile = width <= 760;
      const browseHeight = Math.min(0.64, mobile ? 0.74 * aspect * H / W : 0.64);
      const browseDistance = Math.max(1.35 + H / (2 * tangent * browseHeight), mobile ? 0 : 8.25 / (2 * tangent * aspect));
      const selectedHeight = Math.min(0.84, 0.78 * aspect * H / W);
      const selectedDistance = 0.8 + H * 1.12 / (2 * tangent * selectedHeight);
      const selectedY = -(0.34 + selectedHeight / 2 - 0.5) * 2 * (selectedDistance - 0.8) * tangent;
      camera.position.set(0, lerp(0.55, 1.7, selection), lerp(browseDistance, selectedDistance, selection));
      camera.lookAt(0, lerp(-0.65, 0, selection), 0);
      camera.updateMatrixWorld();
      if (!selecting && !drag) {
        targetAngle += velocity * dt;
        velocity *= Math.exp(-dt * 5);
        if (Math.abs(velocity) < 0.035 && now - lastWheelAt > 180) {
          velocity = 0;
          targetAngle = Math.round(targetAngle / stepAngle) * stepAngle;
        }
      }
      angle = reduced ? targetAngle : THREE.MathUtils.lerp(angle, targetAngle, 1 - Math.exp(-dt * 11));
      const nextActive = ((Math.round(-angle / stepAngle) % PACK_SETTINGS.count) + PACK_SETTINGS.count) % PACK_SETTINGS.count;
      if (nextActive !== active) { active = nextActive; p.onActive(active); }
      const mouthOpening = THREE.MathUtils.smoothstep(detachment, 0, 0.45);
      const updateTear = lastTear !== p.tear || lastSelected !== p.selected || lastOpening !== mouthOpening;
      for (let index = 0; index < packs.length; index++) {
        const pack = packs[index];
        const motion = motions[index];
        if (reduced) motion.velocity = 0;
        if (drag?.pack !== index && !selecting) {
          motion.targetYaw += motion.velocity * dt;
          motion.velocity *= Math.exp(-dt * PACK_SPIN.decay);
          if (Math.abs(motion.velocity) < 0.01) motion.velocity = 0;
        }
        motion.yaw = reduced ? motion.targetYaw : lerp(motion.yaw, motion.targetYaw, 1 - Math.exp(-dt * PACK_SPIN.response));
        motion.pitch = reduced ? motion.targetPitch : lerp(motion.pitch, motion.targetPitch, smooth);
        const hovered = !reduced && !selecting && !drag && hover?.index === index;
        motion.hoverX = reduced ? 0 : lerp(motion.hoverX, hovered ? (hover!.x - 0.5) * 0.12 : 0, smooth);
        motion.hoverY = reduced ? 0 : lerp(motion.hoverY, hovered ? (hover!.y - 0.5) * -0.09 : 0, smooth);
        pack.effects.hover.value.z = reduced ? 0 : lerp(pack.effects.hover.value.z, hovered ? 1 : 0, smooth);
        if (hovered) {
          pack.effects.hover.value.x = lerp(pack.effects.hover.value.x, hover!.x, smooth);
          pack.effects.hover.value.y = lerp(pack.effects.hover.value.y, hover!.y, smooth);
          pack.effects.face.value = hover!.face;
        }
        pack.effects.time.value = clock + index * 0.83;
        pack.effects.motion.value = reduced ? 0 : 1 - selection;
        const a = angle + index * stepAngle;
        const selected = index === p.selected;
        const x = Math.sin(a) * 3.45 * PACK_SETTINGS.spacing;
        const z = Math.cos(a) * 1.65 * PACK_SETTINGS.depth;
        const floatPhase = clock * TAU / 5.2 + index * 1.7;
        const float = reduced ? 0 : Math.sin(floatPhase) * 0.052;
        const rock = reduced ? 0 : Math.sin(floatPhase * 0.83 + 0.6) * 0.026;
        const destinationX = selected ? 0 : Math.sign(x || 1) * 12;
        const destinationY = selected ? selectedY : 0;
        const destinationZ = selected ? 0.8 : z - 3;
        pack.group.position.set(
          THREE.MathUtils.lerp(x, destinationX, selection),
          THREE.MathUtils.lerp(float, destinationY, selection) - (selected ? Math.pow(detachment, 3) * 0.7 : 0),
          THREE.MathUtils.lerp(z, destinationZ, selection),
        );
        // Pick the shortest route to a front-facing pack when selected.
        const normalized = Math.atan2(Math.sin(a), Math.cos(a)) - Math.sin(a) * 0.4;
        pack.group.rotation.set(
          (motion.pitch + motion.hoverY + rock * 0.35) * (1 - selection),
          (normalized + motion.yaw + motion.hoverX) * (1 - selection),
          rock * (1 - selection),
        );
        const scale = THREE.MathUtils.lerp(1, selected ? 1.12 : 0.7, selection);
        pack.group.scale.setScalar(scale);
        pack.reflection.visible = !selecting && selection < 0.02;
        pack.reflection.position.copy(pack.group.position);
        pack.reflection.position.y = FLOOR * 2 - pack.group.position.y;
        // Reflect the complete world transform, including pitch and rocking.
        pack.reflection.quaternion.copy(pack.group.quaternion);
        pack.reflection.quaternion.x *= -1;
        pack.reflection.quaternion.z *= -1;
        pack.reflection.scale.set(scale, -scale, scale);
        // Faded films cannot occlude the far side with depth writes disabled.
        // Keep only the facing print, so a flipped reflection never shows both.
        reflectionNormal.set(0, 0, 1).applyQuaternion(pack.reflection.quaternion);
        reflectionView.copy(camera.position).sub(pack.reflection.position);
        const reflectedFace = reflectionNormal.dot(reflectionView) >= 0 ? 0 : 1;
        for (const face of pack.reflection.children) face.visible = face.userData.face === reflectedFace;
        shadows[index].position.x = pack.group.position.x;
        shadows[index].position.z = pack.group.position.z;
        shadows[index].material.opacity = (1 - selection) * PACK_SETTINGS.shadow * (0.9 - float * 1.2);
        shadows[index].scale.setScalar(1 + float * 0.7);
        const exit = THREE.MathUtils.smoothstep(detachment, 0, 1);
        if (selected) canvas.style.opacity = String(1 - exit);
        pack.strip.position.set(selected ? detachment * 1.25 : 0,
          selected ? Math.sin(detachment * Math.PI) * 0.45 + detachment * 0.15 : 0,
          selected ? detachment * 0.4 : 0);
        pack.strip.rotation.set(selected ? detachment * 0.6 : 0, 0, selected ? -detachment * 0.45 : 0);
        if (updateTear && (selected || index === lastSelected)) deformPack(pack, selected ? p.tear : 0, selected ? mouthOpening : 0);
        if (selected) {
          pack.group.updateMatrixWorld(true);
          const topLeft = pack.group.localToWorld(new THREE.Vector3(-W / 2, H / 2, 0.12)).project(camera);
          const seam = pack.group.localToWorld(new THREE.Vector3(0, CUT, 0.12)).project(camera);
          const bottomRight = pack.group.localToWorld(new THREE.Vector3(W / 2, -H / 2, 0.12)).project(camera);
          const bounds = {
            left: (topLeft.x + 1) * width / 2,
            top: (1 - topLeft.y) * height / 2,
            width: (bottomRight.x - topLeft.x) * width / 2,
            height: (topLeft.y - bottomRight.y) * height / 2,
            seamY: (1 - seam.y) * height / 2,
          };
          const signature = Object.values(bounds).map(Math.round).join();
          if (signature !== lastBounds) { lastBounds = signature; p.onBounds(bounds); }
        }
      }
      lastTear = p.tear;
      lastSelected = p.selected;
      lastOpening = mouthOpening;
      flakes.visible = p.opening && !reduced && p.selected !== null;
      if (flakes.visible) {
        const pack = packs[p.selected!];
        const origin = pack.group.localToWorld(new THREE.Vector3(0, CUT, 0.2));
        for (let index = 0; index < 24; index++) {
          const spread = Math.sin(index * 13.7);
          flakePositions[index * 3] = origin.x + (index / 23 - 0.5) * W + spread * detachment * 0.55;
          flakePositions[index * 3 + 1] = origin.y + Math.abs(Math.cos(index * 7.3)) * detachment * 0.8 - detachment * detachment * 0.7;
          flakePositions[index * 3 + 2] = origin.z + Math.cos(index * 4.1) * detachment * 0.35;
        }
        flakeGeometry.getAttribute("position").needsUpdate = true;
        flakeMaterial.opacity = (1 - detachment) * PACK_SETTINGS.sparks;
      }
      renderer.render(scene, camera);
      canvas.style.visibility = "";
      markShadersReady();
      markPrepared();
      if (!announced) { announced = true; performance.mark("tcg:visible"); p.onReady(); }
      if (detachment >= 1 && !opened) { opened = true; p.onOpened(); }
      if (loaded && (!reduced || (p.opening && !opened) || drag || Math.abs(angle - targetAngle) > 0.001 || Math.abs(selection - Number(selecting)) > 0.001)) frame = requestAnimationFrame(render);
    }
    function wake() {
      if (!frame && alive && loaded && visible && !document.hidden && !latest.current.paused) {
        previous = performance.now();
        frame = requestAnimationFrame(render);
      }
    }
    function restoreSpins() {
      for (const motion of motions) {
        motion.yaw = Math.atan2(Math.sin(motion.yaw), Math.cos(motion.yaw));
        motion.targetYaw = motion.targetPitch = motion.velocity = 0;
      }
    }
    function hitAt(event: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      point.set(((event.clientX - rect.left) / width) * 2 - 1, 1 - ((event.clientY - rect.top) / height) * 2);
      raycaster.setFromCamera(point, camera);
      return raycaster.intersectObjects(packs.map(pack => pack.group), true)[0];
    }
    stepRef.current = direction => {
      if (latest.current.paused || latest.current.selected !== null) return;
      restoreSpins();
      velocity = 0;
      targetAngle = Math.round(targetAngle / stepAngle) * stepAngle - direction * stepAngle;
      wake();
    };
    spinRef.current = direction => {
      if (latest.current.paused || latest.current.selected !== null || !loaded) return;
      velocity = 0;
      motions[active].velocity = 0;
      motions[active].targetYaw += direction * Math.PI;
      wake();
    };
    const pointerDown = (event: PointerEvent) => {
      if (latest.current.paused || latest.current.selected !== null || !event.isPrimary || event.button !== 0) return;
      const hit = hitAt(event);
      const index = hit ? hit.object.userData.pack as number : null;
      const pack = index === active ? active : null;
      const distance = camera.position.z - (packs[active]?.group.position.z ?? 0);
      const projectedWidth = W / (2 * distance * tangent) * logicalHeight;
      canvas.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, pack, hit: index, startX: event.clientX, startY: event.clientY,
        lastX: event.clientX, lastY: event.clientY, lastTime: event.timeStamp, moved: false, spinScale: Math.PI * PACK_SPIN.sensitivity / Math.max(120, projectedWidth) };
      velocity = 0;
      if (pack !== null) {
        targetAngle = angle;
        motions[pack].velocity = 0;
        motions[pack].targetYaw = motions[pack].yaw;
      }
      hover = null;
      canvas.style.cursor = "grabbing";
      wake();
    };
    const pointerMove = (event: PointerEvent) => {
      if (latest.current.paused || latest.current.selected !== null) return;
      if (drag?.id === event.pointerId) {
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 7) {
          drag.moved = true;
          if (drag.pack === null) restoreSpins();
        }
        if (drag.moved) {
          const delta = dx * (drag.pack === null ? 0.006 : drag.spinScale);
          const maxSpeed = drag.pack === null ? 5 : PACK_SPIN.maxSpeed;
          const speed = latest.current.reduced ? 0 : clamp(delta / Math.max((event.timeStamp - drag.lastTime) / 1000, 0.016), -maxSpeed, maxSpeed);
          if (drag.pack === null) { targetAngle += delta; velocity = speed; }
          else {
            const motion = motions[drag.pack];
            motion.targetYaw += delta;
            motion.targetPitch = clamp(motion.targetPitch + dy * 0.002, -Math.PI / 15, Math.PI / 15);
            motion.velocity = speed;
          }
        }
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        drag.lastTime = event.timeStamp;
      } else if (event.pointerType === "mouse" && !latest.current.reduced) {
        const hit = hitAt(event);
        if (hit && hit.object.userData.face !== undefined) {
          const index = hit.object.userData.pack as number;
          const local = packs[index].group.worldToLocal(hit.point.clone());
          hover = { index, x: local.x / W + 0.5, y: local.y / H + 0.5, face: hit.object.userData.face as number };
        } else hover = null;
      }
      wake();
    };
    const pointerUp = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      const click = !drag.moved && event.type === "pointerup";
      const hit = drag.hit;
      if (drag.pack !== null) {
        motions[drag.pack].targetPitch = 0;
        if (event.type !== "pointerup" || event.timeStamp - drag.lastTime > 100) motions[drag.pack].velocity = 0;
      } else if (event.type !== "pointerup" || event.timeStamp - drag.lastTime > 100) velocity = 0;
      drag = null;
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (click && latest.current.selected === null) {
        if (hit !== null && hitAt(event)?.object.userData.pack === hit) latest.current.onSelect(hit);
      }
      wake();
    };
    const pointerLeave = () => { hover = null; wake(); };
    const wheel = (event: WheelEvent) => {
      if (latest.current.paused || latest.current.selected !== null || event.ctrlKey || drag) return;
      event.preventDefault();
      restoreSpins();
      const delta = clamp((Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * (event.deltaMode === 1 ? 16 : 1), -100, 100);
      targetAngle -= delta * 0.007;
      lastWheelAt = performance.now();
      velocity = 0;
      wake();
    };
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else wake(); };
    const lost = (event: Event) => { event.preventDefault(); latest.current.onUnavailable(); };
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("lostpointercapture", pointerUp);
    canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("webglcontextlost", lost);
    document.addEventListener("visibilitychange", visibility);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const intersection = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) wake(); });
    intersection.observe(container);
    resize();
    // Reset the retained scene without recompiling its materials or reloading
    // textures. Pause immediately when hidden, including during pointer capture.
    const wakeEvent = () => {
      const p = latest.current;
      if (p.paused || lastReset !== p.resetVersion) {
        const pointer = drag?.id;
        drag = null;
        if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
        hover = null;
        canvas.style.cursor = "grab";
      }
      if (lastReset !== p.resetVersion) {
        if (lastSelected != null && packs[lastSelected]) deformPack(packs[lastSelected], 0, 0);
        angle = targetAngle = velocity = selection = detachment = openingTime = active = 0;
        opened = false;
        lastWheelAt = 0;
        lastBounds = "";
        lastSelected = undefined;
        lastTear = lastOpening = -1;
        canvas.style.opacity = "1";
        for (const motion of motions) Object.assign(motion, { yaw: 0, targetYaw: 0, pitch: 0, targetPitch: 0, velocity: 0, hoverX: 0, hoverY: 0 });
        lastReset = p.resetVersion;
      }
      if (p.paused) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else resize();
    };
    container.addEventListener("tcg-update", wakeEvent);

    return () => {
      alive = false;
      cancelPreparationFrame();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("lostpointercapture", pointerUp);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("webglcontextlost", lost);
      document.removeEventListener("visibilitychange", visibility);
      container.removeEventListener("tcg-update", wakeEvent);
      geometries.forEach(geometry => geometry.dispose());
      packs.forEach(resetPack);
      packGeometry?.dispose();
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      environment?.dispose();
      if (!renderer.getContext().isContextLost()) renderer.resetState();
      renderer.dispose();
      releaseCanvas("packs", canvas, renderer.getContext());
      stepRef.current = () => {};
      spinRef.current = () => {};
    };
  }, [props.front, props.back]);

  useEffect(() => { root.current?.dispatchEvent(new Event("tcg-update")); });
  return <div ref={root} className="tcg-scene" data-paused={props.paused || undefined} />;
}
