import { Html, OrbitControls, Text } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Model } from '../../../shared/types.ts';
import { fmtBench } from '../../lib/format.ts';
import { useTokens } from '../../lib/tokens.ts';
import { openModel } from '../../lib/ui-state.ts';
import type { CellInfo, Column } from '../../tabs/bench/columns.ts';

const GAP_X = 0.34;
const GAP_Z = 0.5;
const W = 0.24;
const H = 3.2;
/** Fixed instance capacity (80 models × ~110 columns fits comfortably). A stable capacity means the
 *  InstancedMesh is never re-created when filters change; only `count` moves. */
const CAPACITY = 16000;

/** Re-frame the camera whenever the filtered grid changes size (the grid is centred on the origin). */
function CameraRig({ span }: { span: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    const d = Math.max(span, 6);
    camera.position.set(d * 0.78, d * 0.62, d * 0.95);
    camera.lookAt(0, 0, 0);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [span, camera, controls]);
  return null;
}

/**
 * "Benchmark skyline": one instanced bar per filled cell. x = models in release
 * order, z = benchmark columns, height = score relative to the column's range.
 */
export default function BenchSkyline({ models, cols, cells }: { models: Model[]; cols: Column[]; cells: Map<string, CellInfo> }) {
  const t = useTokens();
  const mesh = useRef<THREE.InstancedMesh>(null);
  const [hover, setHover] = useState<number | null>(null);
  const bars = useMemo(() => {
    const out: { m: Model; c: Column; cell: CellInfo; x: number; z: number; h: number }[] = [];
    models.forEach((m, i) =>
      cols.forEach((c, j) => {
        const cell = cells.get(`${m.id}|${c.key}`);
        if (cell) out.push({ m, c, cell, x: (i - models.length / 2) * GAP_X, z: (j - cols.length / 2) * GAP_Z, h: 0.06 + cell.shade * H });
      }),
    );
    return out;
  }, [models, cols, cells]);

  useLayoutEffect(() => {
    const im = mesh.current;
    if (!im) return;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    bars.forEach((b, i) => {
      o.position.set(b.x, b.h / 2, b.z);
      o.scale.set(1, b.h, 1);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      col.set(t.lab[b.m.labGroup]);
      if (b.cell.sota) col.lerp(new THREE.Color('#ffffff'), 0.25);
      im.setColorAt(i, col);
    });
    im.count = Math.min(bars.length, CAPACITY);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    // Bounds must follow the new layout, or raycasting (hover) uses the stale footprint.
    im.computeBoundingSphere();
    im.computeBoundingBox();
  }, [bars, t]);

  const hb = hover !== null && hover < bars.length ? bars[hover] : undefined;
  const span = Math.max(models.length * GAP_X, cols.length * GAP_Z);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return (
    <Canvas camera={{ position: [span * 0.78, span * 0.62, span * 0.95], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <CameraRig span={span} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 18, 8]} intensity={1.3} />
      <directionalLight position={[-12, 6, -10]} intensity={0.35} color={t.glowB} />
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, CAPACITY]}
        frustumCulled={false}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => (e.stopPropagation(), setHover(e.instanceId ?? null))}
        onPointerOut={() => setHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => e.instanceId !== undefined && bars[e.instanceId] && openModel(bars[e.instanceId].m.id)}
      >
        <boxGeometry args={[W, 1, W]} />
        <meshStandardMaterial roughness={0.35} metalness={0.15} />
      </instancedMesh>
      {/* Floor grid */}
      <gridHelper args={[span * 1.3, 40, t.line2, t.line]} position={[0, 0, 0]} />
      {/* Group labels along z */}
      {cols.map((c, j) =>
        j === 0 || cols[j - 1].group !== c.group ? (
          <Text key={c.key} position={[(-models.length / 2) * GAP_X - 0.6, 0.02, (j - cols.length / 2) * GAP_Z]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.28} color={t.text3} anchorX="right">
            {c.group.toUpperCase()}
          </Text>
        ) : null,
      )}
      {/* Year ticks along x */}
      {models.map((m, i) =>
        i === 0 || models[i - 1].released.slice(0, 4) !== m.released.slice(0, 4) ? (
          <Text key={m.id} position={[(i - models.length / 2) * GAP_X, 0.02, (cols.length / 2) * GAP_Z + 0.6]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.34} color={t.text2} anchorX="left">
            {m.released.slice(0, 4)}
          </Text>
        ) : null,
      )}
      {hb && (
        <Html position={[hb.x, hb.h + 0.35, hb.z]} center style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded-lg border border-line-2 bg-surface-2/95 px-2.5 py-1.5 text-[12px] shadow-xl backdrop-blur">
            <div className="font-medium text-ink">{hb.m.name}</div>
            <div className="text-ink-2">
              {hb.c.bench.name}
              {hb.c.sub ? ` (${hb.c.sub})` : ''}: <span className="font-mono text-ink">{fmtBench(hb.cell.value, hb.c.bench)}</span>
              {hb.cell.sota ? ' ★' : ''}
            </div>
          </div>
        </Html>
      )}
      <OrbitControls makeDefault enableDamping autoRotate={!reduced && hover === null} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 2.1} minDistance={4} maxDistance={span * 2} />
    </Canvas>
  );
}
