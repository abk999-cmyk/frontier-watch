import { Float } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useTokens } from '../../lib/tokens.ts';

/** Progress arc as a torus whose vertex colours sweep glow-a → glow-b → accent along its length. */
function ProgressRing({ value, colors }: { value: number; colors: [string, string, string] }) {
  const mesh = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const progress = useRef(0);
  const geos = useMemo(() => {
    const make = (arc: number) => {
      const g = new THREE.TorusGeometry(1.6, 0.075, 24, 220, Math.max(arc, 0.0001));
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const [a, b, c] = colors.map((x) => new THREE.Color(x));
      const tmp = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const ang = Math.atan2(pos.getY(i), pos.getX(i));
        const t = ((ang < 0 ? ang + Math.PI * 2 : ang) / (Math.PI * 2)) / Math.max(arc / (Math.PI * 2), 0.0001);
        const k = Math.min(1, Math.max(0, t));
        if (k < 0.5) tmp.copy(a).lerp(b, k * 2);
        else tmp.copy(b).lerp(c, (k - 0.5) * 2);
        col.set([tmp.r, tmp.g, tmp.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    // Pre-build 101 arcs so the fill animation is just a geometry swap.
    return Array.from({ length: 101 }, (_, i) => make((Math.PI * 2 * i) / 100));
  }, [colors]);
  const glowGeos = useMemo(
    () =>
      geos.map((g) => {
        const p = (g as THREE.TorusGeometry).parameters;
        const w = new THREE.TorusGeometry(p.radius, 0.22, 16, 220, p.arc);
        const src = g.attributes.color as THREE.BufferAttribute;
        const col = new Float32Array(w.attributes.position.count * 3);
        for (let i = 0; i < w.attributes.position.count; i++) {
          const j = Math.min(src.count - 1, Math.floor((i / w.attributes.position.count) * src.count));
          col.set([src.getX(j), src.getY(j), src.getZ(j)], i * 3);
        }
        w.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return w;
      }),
    [geos],
  );

  useFrame((_, dt) => {
    progress.current = Math.min(value, progress.current + dt * 45);
    const g = geos[Math.round(progress.current)];
    if (mesh.current) mesh.current.geometry = g;
    if (glow.current) glow.current.geometry = glowGeos[Math.round(progress.current)];
  });

  return (
    <group rotation={[0, 0, Math.PI / 2]} scale={[-1, 1, 1]}>
      <mesh ref={mesh} geometry={geos[0]}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
      {/* Soft additive halo in place of post-processing bloom (keeps the canvas transparent). */}
      <mesh ref={glow} geometry={geos[0]} scale={[1, 1, 1]}>
        <meshBasicMaterial vertexColors transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Core({ color, value }: { color: string; value: number }) {
  const ref = useRef<THREE.Group>(null);
  const pts = useMemo(() => {
    const n = 420;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 1.05 + Math.random() * 0.25;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      arr.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3);
    }
    return arr;
  }, []);
  useFrame((s, dt) => {
    const g = ref.current;
    if (!g) return;
    g.rotation.y += dt * 0.25;
    g.rotation.x += dt * 0.07;
    const pulse = 1 + Math.sin(s.clock.elapsedTime * 1.6) * 0.03 * (value / 100);
    g.scale.setScalar(pulse);
  });
  return (
    <group ref={ref}>
      <mesh>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.42, 0]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[pts, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.018} color={color} transparent opacity={0.8} toneMapped={false} />
      </points>
    </group>
  );
}

function Ticks({ color }: { color: string }) {
  const geo = useMemo(() => {
    const segs: number[] = [];
    for (let i = 0; i < 100; i++) {
      const a = Math.PI / 2 - (i / 100) * Math.PI * 2;
      const r0 = i % 10 === 0 ? 1.84 : 1.88;
      const r1 = 1.95;
      segs.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={color} transparent opacity={0.45} />
    </lineSegments>
  );
}

export default function AgiOrb({ value }: { value: number }) {
  const t = useTokens();
  const colors = useMemo(() => [t.glowA, t.glowB, t.accent] as [string, string, string], [t.glowA, t.glowB, t.accent]);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <Canvas camera={{ position: [0, 0, 5.2], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <Float speed={reduced ? 0 : 1.4} rotationIntensity={0.35} floatIntensity={0.4}>
        <group rotation={[-0.18, 0.28, 0]}>
          <mesh rotation={[0, 0, 0]}>
            <torusGeometry args={[1.6, 0.03, 12, 200]} />
            <meshBasicMaterial color={t.text3} transparent opacity={0.25} />
          </mesh>
          <ProgressRing value={value} colors={colors} />
          <Ticks color={t.text3} />
          <Core color={t.accent} value={value} />
        </group>
      </Float>
    </Canvas>
  );
}
