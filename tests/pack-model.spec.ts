import { expect, test } from "@playwright/test";
import * as THREE from "three";
import { createPack, createPackGeometry, deformPack, resetPack } from "../src/components/pack-model";

test("five unopened packs share the exact original wrapper buffers", () => {
  const shared = createPackGeometry();
  const front = new THREE.Texture(), back = new THREE.Texture();
  const packs = Array.from({ length: 5 }, (_, index) => createPack(front, back, index, shared));
  try {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const pack of packs) for (const group of [pack.group, pack.reflection]) group.traverse(object => {
      if (object instanceof THREE.Mesh) geometries.add(object.geometry);
    });
    expect(geometries.size).toBe(9);
    expect([...geometries].reduce((sum, geometry) => sum + geometry.getAttribute("position").count, 0)).toBe(20_278);
    for (const pack of packs) for (const [index, film] of pack.films.entries()) {
      expect(film.geometry).toBe(packs[0].films[index].geometry);
      expect(film.geometry.getAttribute("position").array).toEqual(film.original);
    }
  } finally {
    const materials = new Set<THREE.Material>();
    packs.forEach(pack => { for (const group of [pack.group, pack.reflection]) group.traverse(object => { if (object instanceof THREE.Mesh) materials.add(object.material as THREE.Material); }); });
    materials.forEach(material => material.dispose());
    shared.dispose(); front.dispose(); back.dispose();
  }
});

test("tearing isolates one pack and reset restores and disposes all editable copies", () => {
  const shared = createPackGeometry();
  const front = new THREE.Texture(), back = new THREE.Texture();
  const first = createPack(front, back, 0, shared), neighbor = createPack(front, back, 1, shared);
  const originals = first.films.map(film => ({ geometry: film.geometry, positions: new Float32Array(film.geometry.getAttribute("position").array), normals: new Float32Array(film.geometry.getAttribute("normal").array) }));
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      deformPack(first, 0.75, 0.5);
      expect(first.mouth.visible).toBe(true);
      let disposed = 0;
      for (const [index, film] of first.films.entries()) {
        expect(film.geometry).not.toBe(originals[index].geometry);
        expect(film.meshes.every(mesh => mesh.geometry === film.geometry)).toBe(true);
        expect(neighbor.films[index].geometry).toBe(originals[index].geometry);
        expect(neighbor.films[index].geometry.getAttribute("position").array).toEqual(originals[index].positions);
        expect(neighbor.films[index].geometry.getAttribute("normal").array).toEqual(originals[index].normals);
        film.geometry.addEventListener("dispose", () => { disposed++; });
      }
      // Cancel an interrupted tear, then repeat on the same retained pack.
      deformPack(first, 0, 0);
      expect(disposed).toBe(8);
      expect(first.mouth.visible).toBe(false);
      for (const [index, film] of first.films.entries()) {
        expect(film.geometry).toBe(originals[index].geometry);
        expect(film.meshes.every(mesh => mesh.geometry === film.geometry)).toBe(true);
      }
      resetPack(first);
      expect(disposed).toBe(8);
    }
  } finally {
    const materials = new Set<THREE.Material>();
    for (const pack of [first, neighbor]) {
      resetPack(pack);
      for (const group of [pack.group, pack.reflection]) group.traverse(object => { if (object instanceof THREE.Mesh) materials.add(object.material as THREE.Material); });
    }
    materials.forEach(material => material.dispose());
    shared.dispose(); front.dispose(); back.dispose();
  }
});
