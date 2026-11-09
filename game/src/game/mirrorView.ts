import * as THREE from 'three/webgpu';

// Bevelled, two-sided glass on a library lectern; no reflection render pass needed.
export function createMirror() {
  const root = new THREE.Group(), head = new THREE.Group();
  const metal = (color: number) => new THREE.MeshStandardNodeMaterial({ color, metalness: .45, roughness: .32 });
  const bronze = metal(0xa18b69), dark = metal(0x35384f), silver = metal(0x9caebc);
  const add = (parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  add(root, new THREE.CylinderGeometry(.56, .7, .16, 8), dark, 0, .08);
  add(root, new THREE.CylinderGeometry(.39, .53, .12, 8), bronze, 0, .2);
  add(root, new THREE.CylinderGeometry(.15, .24, .65, 8), dark, 0, .52);
  add(root, new THREE.TorusGeometry(.25, .045, 6, 16), bronze, 0, .63).rotation.x = Math.PI / 2;
  head.position.y = 1.42; root.add(head);
  const outline = new THREE.Shape();
  outline.moveTo(-.55, -.68); outline.lineTo(.55, -.68); outline.lineTo(.77, -.44); outline.lineTo(.77, .44);
  outline.lineTo(.55, .68); outline.lineTo(-.55, .68); outline.lineTo(-.77, .44); outline.lineTo(-.77, -.44); outline.closePath();
  add(head, new THREE.ExtrudeGeometry(outline, { depth: .13, bevelEnabled: true, bevelSize: .055, bevelThickness: .04, bevelSegments: 1, steps: 1 }), bronze, 0, 0, -.065);
  const glassGeometry = new THREE.ShapeGeometry(outline), positions = glassGeometry.getAttribute('position'), colors: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const k = THREE.MathUtils.clamp((positions.getY(i) + .68) / 1.36, 0, 1);
    new THREE.Color(0x29455e).lerp(new THREE.Color(0xa3d9df), k).toArray(colors, i * 3);
  }
  glassGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const glass = new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  const gleam = new THREE.MeshBasicNodeMaterial({ color: 0xe4faff, transparent: true, opacity: .48, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const rune = new THREE.MeshBasicNodeMaterial({ color: 0x8ff0ff, toneMapped: false });
  for (const side of [-1, 1]) {
    const face = add(head, glassGeometry, glass, 0, 0, side * .111); face.scale.set(.89, .88, 1);
    const points = outline.getPoints();
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...points, points[0]]), new THREE.LineBasicMaterial({ color: 0xa9d4dd }));
    edge.scale.set(.9, .89, 1); edge.position.z = side * .115; head.add(edge);
    for (const [x, width, height] of [[-.24, .15, .87], [.08, .045, 1.04]]) {
      const shine = add(head, new THREE.PlaneGeometry(width, height), gleam, x, .02, side * .12); shine.rotation.z = -.48;
    }
    for (const x of [-.66, .66]) add(head, new THREE.SphereGeometry(.047, 8, 6), silver, x, 0, side * .12);
  }
  const crest = add(head, new THREE.OctahedronGeometry(.12), rune, 0, .79); crest.scale.y = 1.45;
  const hinge = add(head, new THREE.CylinderGeometry(.09, .09, 1.78, 8), dark, 0, 0); hinge.rotation.z = Math.PI / 2;
  root.userData.update = (angle: number, time: number, active: boolean) => {
    head.rotation.y = angle;
    gleam.opacity = (active ? .58 : .38) + Math.sin(time * 2.4) * .1;
    rune.color.setHex(active ? 0xffd49a : 0x8ff0ff);
  };
  return root;
}
