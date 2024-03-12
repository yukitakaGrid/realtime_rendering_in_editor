export function getViewMatrix(position, target, up) {
    const z = normalize(subtractVectors(target, position));
    console.log(up);
    const x = normalize(cross(up, z));
    const y = cross(z, x);
    return [
      x.x, x.y, x.z, 0,
      y.x, y.y, y.z, 0,
      -z.x, -z.y, -z.z, 0,
      -dot(x, position), -dot(y, position), dot(z, position), 1
    ];
  }
  
  export function getPerspectiveMatrix(fov, aspectRatio, near, far) {
    const f = Math.tan(Math.PI * 0.5 - 0.5 * fov);
    const rangeInverse = 1.0 / (near - far);
    return [
      f / aspectRatio, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * rangeInverse, -1,
      0, 0, near * far * rangeInverse * 2, 0
    ];
  }
  
  function normalize(v) {
    const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  }
  
  function subtractVectors(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }
  
  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
  
  function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }