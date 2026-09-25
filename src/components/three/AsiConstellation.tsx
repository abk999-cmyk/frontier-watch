import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AsiItem, AsiStatus } from '../../../shared/types.ts';
import { useTokens, type Tokens } from '../../lib/tokens.ts';

const RINGS: Record<1 | 2 | 3, { r: number; tilt: [number, number, number]; speed: number; label: string }> = {
  1: { r: 2.1, tilt: [1.22, 0, 0.1], speed: 0.05, label: 'Phase 1 · discovery & simulation' },
  2: { r: 3.25, tilt: [1.32, 0.18, -0.12], speed: -0.035, label: 'Phase 2 · governance & economy' },
  3: { r: 4.45, tilt: [1.42, -0.1, 0.18], speed: 0.022, label: 'Phase 3 · physical world' },
};

interface NodeProps {
  item: AsiItem;
  status: AsiStatus;
  pos: [number, number, number];
  t: Tokens;
  selected: boolean;
  hovered: boolean;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
}

function Node({ item, status, pos, t, selected, hovered, onHover, onSelect }: NodeProps) {
  const ref = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const color = status === 'achieved' ? t.good : status === 'partial' ? t.warn : t.text3;
  const size = status === 'achieved' ? 0.2 : status === 'partial' ? 0.15 : 0.1;
  useFrame((s, dt) => {
    const g = ref.current;
    if (!g) return;
    const target = hovered || selected ? 1.7 : 1;
    g.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, dt * 10));
    if (halo.current) {
      const k = status === 'achieved' ? 1 + Math.sin(s.clock.elapsedTime * 2 + item.id) * 0.18 : 1;
      halo.current.scale.setScalar(k);
    }
  });
  return (
    <group ref={ref} position={pos}>
      <mesh
        onPointerOver={(e) => (e.stopPropagation(), onHover(item.id), (document.body.style.cursor = 'pointer'))}
        onPointerOut={() => (onHover(null), (document.body.style.cursor = ''))}
        onClick={(e) => (e.stopPropagation(), onSelect(item.id))}
      >
        <sphereGeometry args={[Math.max(size, 0.22), 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {status === 'none' ? (
        <mesh>
          <icosahedronGeometry args={[size, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.7} />
        </mesh>
      ) : (
        <mesh>
          <sphereGeometry args={[size, 24, 24]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      )}
      {status !== 'none' && (
        <mesh ref={halo}>
          <ringGeometry args={[size * 1.5, size * 1.75, 32]} />
          <meshBasicMaterial color={color} transparent opacity={status === 'achieved' ? 0.7 : 0.35} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}
      {selected && (
        <mesh>
          <ringGeometry args={[size * 2.3, size * 2.45, 48]} />
          <meshBasicMaterial color={t.accent} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}
      {(hovered || selected) && (
        <Html center distanceFactor={9} position={[0, size + 0.45, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded-lg border border-line-2 bg-surface-2/95 px-2.5 py-1.5 text-[12px] text-ink shadow-xl backdrop-blur">
            <span className="font-mono text-ink-3">#{item.id}</span> {item.keyword ?? item.label}
          </div>
        </Html>
      )}
    </group>
  );
}

function Ring({ phase, items, statuses, t, selected, hovered, onHover, onSelect, spin }: { phase: 1 | 2 | 3; items: AsiItem[]; statuses: Map<number, AsiStatus>; t: Tokens; selected: number | null; hovered: number | null; onHover: (id: number | null) => void; onSelect: (id: number) => void; spin: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const cfg = RINGS[phase];
  const circle = useMemo(() => {
    const pts = new THREE.EllipseCurve(0, 0, cfg.r, cfg.r, 0, Math.PI * 2).getPoints(160).map((p) => new THREE.Vector3(p.x, p.y, 0));
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [cfg.r]);
  useFrame((_, dt) => {
    if (ref.current && spin && hovered === null) ref.current.rotation.z += dt * cfg.speed;
  });
  return (
    <group rotation={cfg.tilt}>
      <lineLoop geometry={circle}>
        <lineBasicMaterial color={t.text3} transparent opacity={0.28} />
      </lineLoop>
      <group ref={ref}>
        {items.map((item, i) => {
          const a = (i / items.length) * Math.PI * 2;
          return (
            <Node
              key={item.id}
              item={item}
              status={statuses.get(item.id) ?? 'none'}
              pos={[Math.cos(a) * cfg.r, Math.sin(a) * cfg.r, 0]}
              t={t}
              selected={selected === item.id}
              hovered={hovered === item.id}
              onHover={onHover}
              onSelect={onSelect}
            />
          );
        })}
      </group>
    </group>
  );
}

function CoreStar({ score, t }: { score: number; t: Tokens }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(s.clock.elapsedTime * 1.3) * 0.05);
  });
  const glow = 0.25 + (score / 100) * 0.75;
  return (
    <group>
      <mesh ref={ref}>
        <sphereGeometry args={[0.55, 48, 48]} />
        <meshBasicMaterial color={t.accent} transparent opacity={glow} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.85, 32, 32]} />
        <meshBasicMaterial color={t.glowA} transparent opacity={0.12} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function AsiConstellation({ items, statuses, score, selected, onSelect }: { items: AsiItem[]; statuses: Map<number, AsiStatus>; score: number; selected: number | null; onSelect: (id: number) => void }) {
  const t = useTokens();
  const [hovered, setHovered] = useState<number | null>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const byPhase = useMemo(() => ({ 1: items.filter((i) => i.phase === 1), 2: items.filter((i) => i.phase === 2), 3: items.filter((i) => i.phase === 3) }), [items]);
  return (
    <Canvas camera={{ position: [0, 7.6, 8.4], fov: 44 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }} onPointerMissed={() => setHovered(null)}>
      <CoreStar score={score} t={t} />
      {([1, 2, 3] as const).map((p) => (
        <Ring key={p} phase={p} items={byPhase[p]} statuses={statuses} t={t} selected={selected} hovered={hovered} onHover={setHovered} onSelect={onSelect} spin={!reduced} />
      ))}
      <OrbitControls enableZoom={false} enablePan={false} autoRotate={!reduced && hovered === null} autoRotateSpeed={0.35} enableDamping minPolarAngle={0.25} maxPolarAngle={1.45} />
    </Canvas>
  );
}

export const RING_LABELS = RINGS;
