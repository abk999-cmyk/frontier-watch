import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useTheme } from '../../lib/tokens.ts';

const STAR_COUNT = 2600;

/** Twinkling starfield shell with a faint equatorial "galaxy band" and pointer parallax. */
function Stars({ dark }: { dark: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const { pointer } = useThree();
  const [geo, mat] = useMemo(() => {
    const pos = new Float32Array(STAR_COUNT * 3);
    const seed = new Float32Array(STAR_COUNT);
    const size = new Float32Array(STAR_COUNT);
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < STAR_COUNT; i++) {
      // 35% of stars hug a tilted band → a subtle Milky-Way streak.
      const band = rnd() < 0.35;
      const theta = rnd() * Math.PI * 2;
      const phi = band ? Math.PI / 2 + (rnd() - 0.5) * 0.35 : Math.acos(2 * rnd() - 1);
      const r = 40 + rnd() * 60;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      seed[i] = rnd() * 100;
      size[i] = band ? 0.6 + rnd() * 1.2 : 0.8 + rnd() * 2.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColorA: { value: new THREE.Color('#9fd7ff') }, uColorB: { value: new THREE.Color('#c6f432') }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float seed; attribute float size; uniform float uTime; varying float vTw; varying float vSeed;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vTw = 0.55 + 0.45 * sin(uTime * (0.6 + fract(seed) * 1.6) + seed);
          vSeed = seed;
          gl_PointSize = size * (220.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColorA; uniform vec3 uColorB; uniform float uAlpha; varying float vTw; varying float vSeed;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          vec3 c = mix(uColorA, uColorB, step(0.985, fract(vSeed * 7.13)));
          gl_FragColor = vec4(c, a * vTw * uAlpha);
        }`,
    });
    return [g, m];
  }, []);

  useFrame((state, dt) => {
    const p = ref.current;
    if (!p) return;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uAlpha.value = dark ? 0.9 : 0.35;
    p.rotation.y += dt * 0.008;
    // Ease toward the pointer for a gentle parallax.
    p.rotation.x += (pointer.y * 0.08 - p.rotation.x) * 0.02;
    p.rotation.z += (-pointer.x * 0.05 - p.rotation.z) * 0.02;
  });

  return <points ref={ref} geometry={geo} material={mat} />;
}

export function SpaceBackground() {
  const theme = useTheme();
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      {/* Nebula washes — pure CSS, cheap. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            theme === 'dark'
              ? 'radial-gradient(1200px 600px at 12% -10%, rgba(124,92,255,.18), transparent 60%), radial-gradient(900px 500px at 95% 10%, rgba(34,199,240,.12), transparent 60%), radial-gradient(1000px 700px at 50% 120%, rgba(198,244,50,.06), transparent 60%)'
              : 'radial-gradient(1200px 600px at 12% -10%, rgba(124,92,255,.10), transparent 60%), radial-gradient(900px 500px at 95% 10%, rgba(14,165,198,.08), transparent 60%)',
        }}
      />
      <Canvas camera={{ position: [0, 0, 1], fov: 70 }} dpr={[1, 1.5]} frameloop={reduced ? 'demand' : 'always'} gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}>
        <Stars dark={theme === 'dark'} />
      </Canvas>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 60%, var(--bg))' }} />
    </div>
  );
}
