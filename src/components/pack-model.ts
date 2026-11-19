import * as THREE from "three";

export const PACK_WIDTH = 1.86;
export const PACK_HEIGHT = 3.5;
export const PACK_CUT = 1.27;
const SEAL = 0.13;
const PUFF = 0.06;
const SHOULDER = PACK_HEIGHT / 2 - SEAL;
const COLUMNS = 160;
const clamp = THREE.MathUtils.clamp;
const tornEdge = (u: number) => Math.sin(u * 173) * 0.007 + Math.sin(u * 311) * 0.003;

function surface(u: number, y: number, back: boolean) {
  const v = clamp((y + SHOULDER) / (SHOULDER * 2), 0, 1);
  const across = Math.sin(u * Math.PI);
  const along = Math.sin(v * Math.PI);
  const taper = 1 - 0.035 * Math.pow(along, 2);
  const x = (u - 0.5) * PACK_WIDTH * taper;
  // The front and back meet at a thin, sealed edge and swell towards the centre.
  const depth = 0.004 + PUFF * Math.pow(across, 0.7) * Math.pow(along, 0.65);
  const fin = back ? 0.006 * Math.exp(-Math.pow((u - 0.51) / 0.016, 2)) * along : 0;
  return new THREE.Vector3(x, y, (back ? -1 : 1) * (depth + fin));
}

function faceGeometry(top: boolean, back: boolean) {
  const min = top ? PACK_CUT : -PACK_HEIGHT / 2;
  const max = top ? PACK_HEIGHT / 2 : PACK_CUT;
  const rows = top ? 12 : 48;
  const geometry = new THREE.PlaneGeometry(PACK_WIDTH, max - min, COLUMNS, rows);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < position.count; index++) {
    const u = uv.getX(index), v = uv.getY(index);
    let y = min + v * (max - min);
    const cutDistance = top ? v : 1 - v;
    y += tornEdge(u) * Math.pow(1 - cutDistance, 16);
    // Zig-zag teeth follow the same foil surface, rather than a separate bar.
    if ((top && v === 1) || (!top && v === 0)) y += (top ? 1 : -1) * ((Math.round(u * COLUMNS) % 2) * 0.014);
    const point = surface(u, y, back);
    position.setXYZ(index, point.x, point.y, point.z);
    uv.setXY(index, back ? 1 - u : u, clamp((y + SHOULDER) / (SHOULDER * 2), 0, 1));
  }
  if (back) {
    const indices = geometry.index!;
    for (let index = 0; index < indices.count; index += 3) {
      const a = indices.getX(index);
      indices.setX(index, indices.getX(index + 2));
      indices.setX(index + 2, a);
    }
  }
  geometry.computeVertexNormals();
  // Both halves sample the same surface normal at the cut. Independently
  // averaging their edge triangles leaves a visible join before opening.
  const normal = geometry.getAttribute("normal");
  for (let index = 0; index < position.count; index++) {
    const u = back ? 1 - uv.getX(index) : uv.getX(index);
    const y = position.getY(index);
    const du = surface(clamp(u + 0.0001, 0, 1), y, back).sub(surface(clamp(u - 0.0001, 0, 1), y, back));
    const dy = surface(u, y + 0.0001, back).sub(surface(u, y - 0.0001, back));
    const n = du.cross(dy).normalize().multiplyScalar(back ? -1 : 1);
    normal.setXYZ(index, n.x, n.y, n.z);
  }
  return geometry;
}

function sideGeometry(top: boolean, right: boolean) {
  const min = top ? PACK_CUT : -PACK_HEIGHT / 2;
  const max = top ? PACK_HEIGHT / 2 : PACK_CUT;
  const geometry = new THREE.PlaneGeometry(1, max - min, 1, top ? 12 : 48);
  const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  const u = right ? 1 : 0;
  for (let index = 0; index < position.count; index++) {
    const v = uv.getY(index);
    const y = min + v * (max - min) + tornEdge(u) * Math.pow(top ? 1 - v : v, 16);
    const point = surface(u, y, uv.getX(index) === 0);
    position.setXYZ(index, point.x, point.y, point.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

type PackEffects = {
  time: THREE.IUniform<number>;
  hover: THREE.IUniform<THREE.Vector3>;
  face: THREE.IUniform<number>;
  motion: THREE.IUniform<number>;
};

function foilMaterial(texture: THREE.Texture, effects: PackEffects, back: boolean, reflection = false) {
  const material = new THREE.MeshPhysicalMaterial({
    map: texture, metalness: 0.82, roughness: 0.31, clearcoat: 0.4,
    clearcoatRoughness: 0.3, iridescence: 0,
    iridescenceThicknessMinimum: 100, iridescenceThicknessMaximum: 360,
    side: THREE.FrontSide,
    transparent: reflection, depthWrite: !reflection,
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uPackTime: effects.time, uPackHover: effects.hover, uPackFace: effects.face, uPackMotion: effects.motion, uPackMaterialFace: { value: Number(back) } });
    shader.vertexShader = "varying vec3 vPackPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvPackPosition = position;");
    shader.fragmentShader = "varying vec3 vPackPosition;\nuniform float uPackTime;\nuniform vec3 uPackHover;\nuniform float uPackFace;\nuniform float uPackMotion;\nuniform float uPackMaterialFace;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", [
      "#include <map_fragment>",
      `float seal = smoothstep(${SHOULDER - 0.008}, ${SHOULDER + 0.008}, abs(vPackPosition.y));`,
      "float rib = 0.97 + 0.03 * sin(vMapUv.x * 1005.3096);",
      "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.57, 0.60) * rib, seal * 0.94);",
      reflection ? "diffuseColor.a *= 0.42 * (1.0 - smoothstep(0.0, 1.35, vPackPosition.y + 1.75));" : "",
    ].join("\n"));
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.46, seal);");
    shader.fragmentShader = shader.fragmentShader.replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.8, seal);");
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>", `
      #include <lights_fragment_end>
      vec2 filmUV = vec2(vPackPosition.x / ${PACK_WIDTH} + 0.5, vPackPosition.y / ${PACK_HEIGHT} + 0.5);
      vec2 lightDelta = (filmUV - uPackHover.xy) * vec2(1.0, 1.35);
      float hoverGlow = exp(-dot(lightDelta, lightDelta) / 0.065) * uPackHover.z;
      hoverGlow *= 1.0 - abs(uPackFace - uPackMaterialFace);
      float sweepPosition = fract(uPackTime / 5.2) * 3.0 - 1.0;
      float sweepDistance = (filmUV.x + filmUV.y * 0.32 - sweepPosition) / 0.13;
      float sweepGlow = exp(-sweepDistance * sweepDistance) * uPackMotion;
      float facing = pow(abs(dot(normal, normalize(vViewPosition))), 0.65);
      vec3 foilLight = vec3(1.0) * (hoverGlow * 0.19 + sweepGlow * 0.14);
      reflectedLight.directSpecular += foilLight * facing * ${reflection ? "0.45" : "1.0"};
    `);
  };
  material.customProgramCacheKey = () => `silver-pouch-v1-${reflection}`;
  return material;
}

type FilmTemplate = { geometry: THREE.BufferGeometry; original: Float32Array; top: boolean };
type Film = FilmTemplate & { template: FilmTemplate; meshes: THREE.Mesh[] };
export interface PackGeometry {
  faces: FilmTemplate[];
  sides: FilmTemplate[];
  mouth: THREE.BufferGeometry;
  dispose: () => void;
}

// All unopened packs have exactly the same shape. Keep one immutable set of
// buffers; only a wrapper that is actually torn needs editable copies.
export function createPackGeometry(): PackGeometry {
  const template = (geometry: THREE.BufferGeometry, top: boolean): FilmTemplate => ({
    geometry, top, original: new Float32Array(geometry.getAttribute("position").array),
  });
  const faces = [false, true].flatMap(back => [false, true].map(top => template(faceGeometry(top, back), top)));
  const sides = [false, true].flatMap(top => [false, true].map(right => template(sideGeometry(top, right), top)));
  const mouth = new THREE.CircleGeometry(1, 64);
  return { faces, sides, mouth, dispose: () => {
    [...faces, ...sides].forEach(film => film.geometry.dispose());
    mouth.dispose();
  } };
}
export interface PackModel {
  group: THREE.Group;
  body: THREE.Group;
  strip: THREE.Group;
  reflection: THREE.Group;
  mouth: THREE.Mesh;
  films: Film[];
  effects: PackEffects;
}

export function createPack(front: THREE.Texture, back: THREE.Texture, index: number, shared: PackGeometry): PackModel {
  const group = new THREE.Group(), body = new THREE.Group(), strip = new THREE.Group(), reflection = new THREE.Group();
  const films: Film[] = [];
  const effects: PackEffects = { time: { value: index * 0.83 }, hover: { value: new THREE.Vector3(0.5, 0.5, 0) }, face: { value: 0 }, motion: { value: 1 } };
  const lining = new THREE.MeshStandardMaterial({ color: "#a9a1aa", metalness: 0.3, roughness: 0.75, side: THREE.BackSide });
  for (const [texture, reverse] of [[front, false], [back, true]] as const) {
    const material = foilMaterial(texture, effects, reverse);
    const reflectedMaterial = foilMaterial(texture, effects, reverse, true);
    for (const top of [false, true]) {
      const template = shared.faces[Number(reverse) * 2 + Number(top)];
      const geometry = template.geometry;
      const face = new THREE.Mesh(geometry, material);
      face.userData.face = reverse ? 1 : 0;
      (top ? strip : body).add(face);
      const liningFace = new THREE.Mesh(geometry, lining);
      (top ? strip : body).add(liningFace);
      const reflectedFace = new THREE.Mesh(geometry, reflectedMaterial);
      reflectedFace.userData.face = reverse ? 1 : 0;
      reflection.add(reflectedFace);
      films.push({ ...template, template, meshes: [face, liningFace, reflectedFace] });
    }
  }
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: "#aaa1a6", metalness: 0.3, roughness: 0.65, side: THREE.DoubleSide });
  for (const top of [false, true]) for (const right of [false, true]) {
    const template = shared.sides[Number(top) * 2 + Number(right)];
    const face = new THREE.Mesh(template.geometry, edgeMaterial);
    (top ? strip : body).add(face);
    films.push({ ...template, template, meshes: [face] });
  }
  const mouth = new THREE.Mesh(shared.mouth, new THREE.MeshBasicMaterial({ color: "#443e47", side: THREE.DoubleSide, transparent: true }));
  mouth.rotation.x = -Math.PI / 2;
  mouth.position.y = PACK_CUT - 0.02;
  mouth.scale.set(PACK_WIDTH * 0.48, PUFF, 1);
  mouth.visible = false;
  body.add(mouth);
  group.add(body, strip);
  group.traverse(object => { object.userData.pack = index; });
  return { group, body, strip, reflection, mouth, films, effects };
}

export function deformPack(pack: PackModel, tear: number, opening: number) {
  if (tear === 0 && opening === 0) { resetPack(pack); return; }
  for (const film of pack.films) {
    if (film.geometry === film.template.geometry) {
      film.geometry = film.template.geometry.clone();
      for (const mesh of film.meshes) mesh.geometry = film.geometry;
    }
    const positions = film.geometry.getAttribute("position");
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const offset = vertex * 3;
      const x = film.original[offset], y = film.original[offset + 1], z = film.original[offset + 2];
      const u = (x + PACK_WIDTH / 2) / PACK_WIDTH;
      const peeled = clamp((tear - u) * 3, 0, 1);
      if (film.top) {
        const curl = peeled * 0.6;
        const hinge = PACK_CUT + 0.12;
        positions.setXYZ(vertex, x, hinge + (y - hinge) * Math.cos(curl) + peeled * 0.09,
          z + (y - hinge) * Math.sin(curl) + peeled * 0.06);
      } else {
        const rim = Math.pow(clamp((y - PACK_CUT + 0.5) / 0.5, 0, 1), 2);
        const across = Math.sin(clamp(u, 0, 1) * Math.PI);
        positions.setXYZ(vertex, x, y - rim * across * opening * 0.07,
          z + Math.sign(z) * rim * across * opening * 0.13);
      }
    }
    positions.needsUpdate = true;
    film.geometry.computeVertexNormals();
  }
  pack.mouth.visible = opening > 0.02;
  pack.mouth.scale.y = PUFF + opening * 0.1;
}

export function resetPack(pack: PackModel) {
  for (const film of pack.films) {
    if (film.geometry === film.template.geometry) continue;
    film.geometry.dispose();
    film.geometry = film.template.geometry;
    for (const mesh of film.meshes) mesh.geometry = film.geometry;
  }
  pack.mouth.visible = false;
  pack.mouth.scale.y = PUFF;
}
