import { Billboard, Html, Line, OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import * as THREE from 'three';
import type { LabGroup } from '../../../shared/types.ts';
import { monthYear } from '../../lib/format.ts';
import { LAB_META } from '../../lib/labs.ts';
import { useTokens, type Tokens } from '../../lib/tokens.ts';
import { openModel } from '../../lib/ui-state.ts';

/**
 * Orbitable 3D capability scatter: x = release date, y = ECI, z = caller-chosen axis
 * (log compute, log METR horizon, or lab lanes). Points without a z value are parked on the
 * back plane at reduced opacity. Frontier (best-ECI-so-far) points are joined by a glowing line.
 */

export interface SpacePoint {
  key: string;
  name: string;
  modelId?: string;
  g: LabGroup;
  date: string;
  /** Fractional year. */
  x: number;
  eci: number;
  eciLo?: number;
  eciHi?: number;
  /** z in axis units (log10 FLOP / log10 minutes / lane index); null = unknown → back plane. */
  z: number | null;
  /** Human-readable z value for the tooltip. */
  zText?: string;
  /** Training compute for the tooltip, shown in every z mode when known. */
  flopText?: string;
  frontier: boolean;
}

export interface SpaceAxis {
  domain: [number, number];
  ticks: { v: number; label: string }[];
  title: string;
}

export interface CapabilitySpaceProps {
  points: SpacePoint[];
  xAxis: SpaceAxis;
  yAxis: SpaceAxis;
  zAxis: SpaceAxis;
  zLabel: string;
  tokens: Tokens;
  /** On screen: false stops rendering entirely. */
  active: boolean;
  reducedMotion: boolean;
  autoRotate: boolean;
  /** Increment to fly the camera back to the default view. */
  resetSignal: number;
}

// Scene box: x ∈ [-5, 5], y ∈ [0, 5], z ∈ [-3, 3].
const X0 = -5;
const X1 = 5;
const H = 5;
const Z0 = -3;
const Z1 = 3;
const TARGET = new THREE.Vector3(0, 2.1, 0);
const CAM0 = new THREE.Vector3(9.5, 6.2, 11.5);
const TARGET_ARR = TARGET.toArray();

const lerpMap = (v: number, [a, b]: [number, number], [c, d]: [number, number]) => (b === a ? (c + d) / 2 : c + ((v - a) / (b - a)) * (d - c));

function LabGeometry({ g }: { g: LabGroup }) {
  switch (g) {
    case 'openai':
      return <sphereGeometry args={[0.13, 20, 14]} />;
    case 'anthropic':
      return <octahedronGeometry args={[0.17]} />;
    case 'google':
      return <tetrahedronGeometry args={[0.2]} />;
    case 'xai':
      return <boxGeometry args={[0.21, 0.21, 0.21]} />;
    case 'china':
      return <dodecahedronGeometry args={[0.16]} />;
    default:
      return <icosahedronGeometry args={[0.09, 0]} />;
  }
}

/** Fixed per-shape orientation so each glyph reads clearly (a tetra "points up", etc.). */
const BASE_ROT: Record<LabGroup, [number, number, number]> = {
  openai: [0, 0, 0],
  anthropic: [0, Math.PI / 4, 0],
  google: [-0.62, 0, Math.PI / 4],
  xai: [0, Math.PI / 5, 0],
  china: [0.3, 0.3, 0],
  other: [0, 0, 0],
};

interface Laid {
  p: SpacePoint;
  x: number;
  y: number;
  z: number;
  parked: boolean;
}

// ── Axis frame ─────────────────────────────────────────────────────────────

/**
 * Axis tick label as WebGL text (troika SDF). Deliberately not drei <Html>: every <Html> is its
 * own React root, and dozens of them unmounting during a tab switch trips React's
 * "synchronously unmount a root while rendering" / removeChild errors.
 */
function Tick({ position, children, strong = false }: { position: [number, number, number]; children: React.ReactNode; strong?: boolean }) {
  const t = useTokens();
  return (
    <Billboard position={position}>
      <Text
        fontSize={strong ? 0.2 : 0.17}
        letterSpacing={strong ? 0.08 : 0}
        color={strong ? t.text2 : t.text3}
        anchorX="center"
        anchorY="middle"
        raycast={() => null}
      >
        {strong ? String(children).toUpperCase() : String(children)}
      </Text>
    </Billboard>
  );
}

function Frame({ xAxis, yAxis, zAxis, t }: { xAxis: SpaceAxis; yAxis: SpaceAxis; zAxis: SpaceAxis; t: Tokens }) {
  const sx = (v: number) => lerpMap(v, xAxis.domain, [X0, X1]);
  const sy = (v: number) => lerpMap(v, yAxis.domain, [0, H]);
  const sz = (v: number) => lerpMap(v, zAxis.domain, [Z0, Z1]);

  const grid = useMemo(() => {
    const v: number[] = [];
    const seg = (a: number[], b: number[]) => v.push(...a, ...b);
    for (const { v: xv } of xAxis.ticks) {
      const x = sx(xv);
      seg([x, 0, Z0], [x, 0, Z1]); // floor
      seg([x, 0, Z0], [x, H, Z0]); // back wall
    }
    for (const { v: yv } of yAxis.ticks) {
      const y = sy(yv);
      seg([X0, y, Z0], [X1, y, Z0]); // back wall
      seg([X0, y, Z0], [X0, y, Z1]); // side wall
    }
    for (const { v: zv } of zAxis.ticks) {
      const z = sz(zv);
      seg([X0, 0, z], [X1, 0, z]); // floor
      seg([X0, 0, z], [X0, H, z]); // side wall
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return g;
  }, [xAxis, yAxis, zAxis]);

  const edges = useMemo(() => {
    const v = [
      // floor rectangle
      X0, 0, Z0, X1, 0, Z0, X1, 0, Z0, X1, 0, Z1, X1, 0, Z1, X0, 0, Z1, X0, 0, Z1, X0, 0, Z0,
      // back verticals + top edges of the two walls
      X0, 0, Z0, X0, H, Z0, X1, 0, Z0, X1, H, Z0, X0, 0, Z1, X0, H, Z1, X0, H, Z0, X1, H, Z0, X0, H, Z0, X0, H, Z1,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return g;
  }, []);

  useEffect(() => () => grid.dispose(), [grid]);
  useEffect(() => () => edges.dispose(), [edges]);

  const dark = t.theme === 'dark';
  return (
    <group>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color={t.text} transparent opacity={dark ? 0.085 : 0.12} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={t.text} transparent opacity={dark ? 0.24 : 0.3} depthWrite={false} />
      </lineSegments>
      {/* Faint wall fills give the box a body without hiding points. */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[X1 - X0, Z1 - Z0]} />
        <meshBasicMaterial color={t.glowB} transparent opacity={dark ? 0.035 : 0.05} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, H / 2, Z0]}>
        <planeGeometry args={[X1 - X0, H]} />
        <meshBasicMaterial color={t.glowA} transparent opacity={dark ? 0.03 : 0.035} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[X0, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[Z1 - Z0, H]} />
        <meshBasicMaterial color={t.glowA} transparent opacity={dark ? 0.02 : 0.03} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {xAxis.ticks.map((k) => (
        <Tick key={`x${k.v}`} position={[sx(k.v), -0.05, Z1 + 0.5]}>
          {k.label}
        </Tick>
      ))}
      {yAxis.ticks.map((k) => (
        <Tick key={`y${k.v}`} position={[X0 - 0.45, sy(k.v), Z0]}>
          {k.label}
        </Tick>
      ))}
      {zAxis.ticks.map((k) => (
        <Tick key={`z${k.v}`} position={[X1 + 0.6, -0.05, sz(k.v)]}>
          {k.label}
        </Tick>
      ))}
      <Tick position={[0, -0.75, Z1 + 1.15]} strong>
        {xAxis.title}
      </Tick>
      <Tick position={[X0 - 0.45, H + 0.55, Z0]} strong>
        {yAxis.title}
      </Tick>
      <Tick position={[X1 + 1.5, -0.6, 0]} strong>
        {zAxis.title}
      </Tick>
    </group>
  );
}

// ── Points, frontier, hover ────────────────────────────────────────────────

interface PointsProps {
  laid: Laid[];
  t: Tokens;
  reducedMotion: boolean;
  zLabel: string;
  onHoverChange: (hovering: boolean) => void;
}

function Points({ laid, t, reducedMotion, zLabel, onHoverChange }: PointsProps) {
  const invalidate = useThree((s) => s.invalidate);
  const [hover, setHover] = useState<number | null>(null);

  // Instanced groups: one per (lab, parked) pair.
  const groups = useMemo(() => {
    const m = new Map<string, { g: LabGroup; parked: boolean; idx: number[] }>();
    laid.forEach((l, i) => {
      const k = `${l.p.g}|${l.parked}`;
      let e = m.get(k);
      if (!e) m.set(k, (e = { g: l.p.g, parked: l.parked, idx: [] }));
      e.idx.push(i);
    });
    return [...m.values()];
  }, [laid]);
  const frontIdx = useMemo(
    () =>
      laid
        .map((l, i) => (l.p.frontier ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => laid[a].x - laid[b].x),
    [laid],
  );

  // z-morph animation between axis modes (x and y never change for a point).
  const lastZ = useRef(new Map<string, number>());
  const anim = useRef({ k: 1, from: new Float32Array(0), to: new Float32Array(0) });
  const zNow = useRef(new Float32Array(0));
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const halo = useRef<THREE.InstancedMesh>(null);
  const line = useRef<ComponentRef<typeof Line>>(null);
  const shadow = useRef<ComponentRef<typeof Line>>(null);
  const drops = useRef<THREE.LineSegments>(null);
  const hoverRef = useRef<number | null>(null);
  hoverRef.current = hover;

  const dummy = useMemo(() => new THREE.Object3D(), []);

  const apply = useCallback(() => {
    const z = zNow.current;
    groups.forEach((grp, gi) => {
      const mesh = meshes.current[gi];
      if (!mesh) return;
      const rot = BASE_ROT[grp.g];
      grp.idx.forEach((li, j) => {
        const l = laid[li];
        dummy.position.set(l.x, l.y, z[li] ?? l.z);
        dummy.rotation.set(rot[0], rot[1], rot[2]);
        dummy.scale.setScalar(hoverRef.current === li ? 1.7 : 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(j, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
    if (halo.current) {
      frontIdx.forEach((li, j) => {
        const l = laid[li];
        dummy.position.set(l.x, l.y, z[li] ?? l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        halo.current!.setMatrixAt(j, dummy.matrix);
      });
      halo.current.instanceMatrix.needsUpdate = true;
    }
    if (frontIdx.length >= 2) {
      const flat: number[] = [];
      const floor: number[] = [];
      for (const li of frontIdx) {
        flat.push(laid[li].x, laid[li].y, z[li]);
        floor.push(laid[li].x, 0.005, z[li]);
      }
      (line.current?.geometry as any)?.setPositions?.(flat);
      (shadow.current?.geometry as any)?.setPositions?.(floor);
    }
    if (drops.current) {
      const pos = drops.current.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (pos && pos.count === frontIdx.length * 2) {
        frontIdx.forEach((li, j) => {
          pos.setXYZ(j * 2, laid[li].x, laid[li].y, z[li]);
          pos.setXYZ(j * 2 + 1, laid[li].x, 0, z[li]);
        });
        pos.needsUpdate = true;
      }
    }
    laid.forEach((l, i) => lastZ.current.set(l.p.key, z[i]));
  }, [groups, frontIdx, laid, dummy]);

  useLayoutEffect(() => {
    const n = laid.length;
    const from = new Float32Array(n);
    const to = new Float32Array(n);
    laid.forEach((l, i) => {
      to[i] = l.z;
      // New points enter from the back wall; existing ones glide from where they were.
      from[i] = lastZ.current.get(l.p.key) ?? Z0;
    });
    anim.current = { k: reducedMotion ? 1 : 0, from, to };
    zNow.current = reducedMotion ? to.slice() : from.slice();
    apply();
    invalidate();
  }, [laid, reducedMotion, apply, invalidate]);

  useLayoutEffect(() => {
    apply();
    invalidate();
  }, [hover, apply, invalidate]);

  useFrame((state, dt) => {
    const a = anim.current;
    if (a.k >= 1) return;
    a.k = Math.min(1, a.k + Math.min(dt, 0.05) / 0.85);
    const e = 1 - Math.pow(1 - a.k, 3);
    const z = zNow.current;
    for (let i = 0; i < z.length; i++) z[i] = a.from[i] + (a.to[i] - a.from[i]) * e;
    apply();
    state.invalidate();
  });

  const onMove = (gi: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId == null) return;
    const li = groups[gi]?.idx[e.instanceId];
    if (li == null || li === hoverRef.current) return;
    setHover(li);
    onHoverChange(true);
    document.body.style.cursor = laid[li].p.modelId ? 'pointer' : 'crosshair';
  };
  const onOut = () => {
    setHover(null);
    onHoverChange(false);
    document.body.style.cursor = '';
  };
  const onClick = (gi: number) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId == null) return;
    const li = groups[gi]?.idx[e.instanceId];
    const id = li != null ? laid[li].p.modelId : undefined;
    if (id) openModel(id);
  };
  useEffect(() => () => void (document.body.style.cursor = ''), []);

  const dark = t.theme === 'dark';
  const accent = useMemo(() => new THREE.Color(t.accent).multiplyScalar(dark ? 1.9 : 1), [t.accent, dark]);
  const initialLine = useMemo(() => frontIdx.map((li) => [laid[li].x, laid[li].y, laid[li].z] as [number, number, number]), [frontIdx, laid]);
  const initialShadow = useMemo(() => frontIdx.map((li) => [laid[li].x, 0.005, laid[li].z] as [number, number, number]), [frontIdx, laid]);
  const dropGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(frontIdx.length * 6), 3));
    return g;
  }, [frontIdx]);
  useEffect(() => () => dropGeo.dispose(), [dropGeo]);

  const h = hover != null ? laid[hover] : null;
  const hz = hover != null ? (zNow.current[hover] ?? h?.z ?? 0) : 0;

  return (
    <group>
      {groups.map((grp, gi) => (
        <instancedMesh
          key={`${grp.g}|${grp.parked}|${grp.idx.length}`}
          ref={(m) => void (meshes.current[gi] = m)}
          args={[undefined, undefined, grp.idx.length]}
          onPointerMove={onMove(gi)}
          onPointerOut={onOut}
          onClick={onClick(gi)}
        >
          <LabGeometry g={grp.g} />
          <meshStandardMaterial
            color={t.lab[grp.g]}
            emissive={t.lab[grp.g]}
            emissiveIntensity={dark ? (grp.parked ? 0.12 : 0.32) : 0.08}
            roughness={0.38}
            metalness={0.15}
            transparent={grp.parked || grp.g === 'other'}
            opacity={grp.parked ? 0.26 : grp.g === 'other' ? 0.6 : 1}
            depthWrite={!grp.parked}
          />
        </instancedMesh>
      ))}

      {frontIdx.length > 0 && (
        <instancedMesh key={`halo${frontIdx.length}`} ref={halo} args={[undefined, undefined, frontIdx.length]} raycast={() => null}>
          <sphereGeometry args={[0.26, 16, 12]} />
          <meshBasicMaterial color={accent} transparent opacity={dark ? 0.16 : 0.22} depthWrite={false} toneMapped={false} />
        </instancedMesh>
      )}
      {frontIdx.length >= 2 && (
        <>
          <Line ref={line} points={initialLine} color={accent} lineWidth={2.4} toneMapped={false} transparent opacity={0.95} raycast={() => null} />
          <Line ref={shadow} points={initialShadow} color={t.accent} lineWidth={1.2} transparent opacity={dark ? 0.22 : 0.35} raycast={() => null} />
          <lineSegments key={`drops${frontIdx.length}`} ref={drops} geometry={dropGeo} raycast={() => null}>
            <lineBasicMaterial color={t.accent} transparent opacity={dark ? 0.18 : 0.3} depthWrite={false} />
          </lineSegments>
        </>
      )}

      {h && (
        <>
          <mesh position={[h.x, h.y, hz]} raycast={() => null}>
            <sphereGeometry args={[0.3, 20, 14]} />
            <meshBasicMaterial color={t.text} wireframe transparent opacity={0.35} depthWrite={false} />
          </mesh>
          {/* Read-off guides: to the floor, the back wall and the side wall. */}
          <Line
            points={[
              [h.x, h.y, hz],
              [h.x, 0, hz],
              [h.x, h.y, hz],
              [h.x, h.y, Z0],
              [h.x, h.y, hz],
              [X0, h.y, hz],
            ]}
            segments
            color={t.text}
            lineWidth={1}
            dashed
            dashSize={0.12}
            gapSize={0.08}
            transparent
            opacity={0.5}
            raycast={() => null}
          />
          <Html position={[h.x, h.y, hz]} zIndexRange={[12, 10]} style={{ pointerEvents: 'none' }}>
            <div className="w-max max-w-[260px] -translate-y-1/2 translate-x-4 rounded-xl border border-line-2 bg-surface-2/95 px-3 py-2 text-[12px] shadow-xl backdrop-blur">
              <div className="flex items-center gap-1.5 font-semibold text-ink">
                <span className="text-[11px]" style={{ color: t.lab[h.p.g] }}>
                  {LAB_META[h.p.g].glyph}
                </span>
                {h.p.name}
              </div>
              <div className="text-[11px] text-ink-3">
                {LAB_META[h.p.g].label} · {monthYear(h.p.date)}
                {h.p.frontier && ' · frontier'}
              </div>
              <div className="mt-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-[11.5px]">
                <span className="text-ink-3">ECI</span>
                <span className="text-right font-mono text-ink">
                  {h.p.eci.toFixed(1)}
                  {h.p.eciLo != null && h.p.eciHi != null && <span className="text-ink-3"> ({h.p.eciLo.toFixed(0)}–{h.p.eciHi.toFixed(0)})</span>}
                </span>
                <span className="text-ink-3">{zLabel}</span>
                <span className="text-right font-mono text-ink">{h.p.zText ?? (h.parked ? 'unknown' : '—')}</span>
                {zLabel !== 'Training compute' && (
                  <>
                    <span className="text-ink-3">Training compute</span>
                    <span className="text-right font-mono text-ink">{h.p.flopText ?? 'unknown'}</span>
                  </>
                )}
              </div>
              {h.parked && <div className="mt-1 text-[10.5px] text-ink-3">No {zLabel.toLowerCase()} value: parked on the back plane.</div>}
              {h.p.modelId && <div className="mt-1 text-[10.5px] text-ink-3">Click for model details</div>}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

// ── Camera rig: reset fly-back, aspect-aware framing, touch policy ────────

function Rig({ resetSignal, reducedMotion, controls }: { resetSignal: number; reducedMotion: boolean; controls: React.RefObject<ComponentRef<typeof OrbitControls> | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const fly = useRef<{ k: number; fromP: THREE.Vector3; fromT: THREE.Vector3; toP: THREE.Vector3 } | null>(null);

  const home = useCallback(() => {
    const aspect = size.width / Math.max(1, size.height);
    const f = aspect < 0.9 ? 1.65 : aspect < 1.3 ? 1.3 : 1;
    return CAM0.clone().sub(TARGET).multiplyScalar(f).add(TARGET);
  }, [size.width, size.height]);

  // Frame the box for the current aspect on mount / resize (only before the user has moved).
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) return;
    camera.position.copy(home());
    camera.lookAt(TARGET);
    controls.current?.target.copy(TARGET);
    controls.current?.update();
    invalidate();
  }, [home, camera, controls, invalidate]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const mark = () => void (moved.current = true);
    c.addEventListener('start', mark);
    return () => c.removeEventListener('start', mark);
  }, [controls]);

  useEffect(() => {
    if (!resetSignal) return;
    const c = controls.current;
    if (!c) return;
    moved.current = false;
    if (reducedMotion) {
      camera.position.copy(home());
      c.target.copy(TARGET);
      c.update();
      invalidate();
      return;
    }
    fly.current = { k: 0, fromP: camera.position.clone(), fromT: c.target.clone(), toP: home() };
    invalidate();
  }, [resetSignal, reducedMotion, camera, controls, home, invalidate]);

  useFrame((state, dt) => {
    const f = fly.current;
    const c = controls.current;
    if (!f || !c) return;
    f.k = Math.min(1, f.k + Math.min(dt, 0.05) / 0.7);
    const e = 1 - Math.pow(1 - f.k, 3);
    camera.position.lerpVectors(f.fromP, f.toP, e);
    c.target.lerpVectors(f.fromT, TARGET, e);
    c.update();
    if (f.k >= 1) fly.current = null;
    state.invalidate();
  });
  return null;
}

/** Render one frame when the scene comes back on screen (demand mode would otherwise wait). */
function Kick({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate]);
  return null;
}

/** Vertical swipes scroll the page until the user engages the scene; then the scene owns touch. */
function TouchPolicy({ engaged }: { engaged: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.domElement.style.touchAction = engaged ? 'none' : 'pan-y';
  }, [gl, engaged]);
  return null;
}

// ── Root ───────────────────────────────────────────────────────────────────

export default function CapabilitySpace({ points, xAxis, yAxis, zAxis, zLabel, tokens: t, active, reducedMotion, autoRotate, resetSignal }: CapabilitySpaceProps) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [interacting, setInteracting] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const resume = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resume.current), []);

  const laid = useMemo<Laid[]>(
    () =>
      points.map((p) => ({
        p,
        x: lerpMap(p.x, xAxis.domain, [X0, X1]),
        y: lerpMap(p.eci, yAxis.domain, [0, H]),
        z: p.z == null ? Z0 : Math.min(Z1, Math.max(Z0, lerpMap(p.z, zAxis.domain, [Z0, Z1]))),
        parked: p.z == null,
      })),
    [points, xAxis.domain, yAxis.domain, zAxis.domain],
  );

  const spinning = autoRotate && !reducedMotion && !interacting && !hovering;
  const frameloop = !active ? 'never' : spinning ? 'always' : 'demand';
  const dark = t.theme === 'dark';
  const bg = dark ? t.bg : t.surface2;

  return (
    <div className="absolute inset-0" onPointerDown={() => setEngaged(true)} onPointerLeave={() => setEngaged(false)}>
      <Canvas
        dpr={[1, 2]}
        frameloop={frameloop}
        camera={{ position: CAM0.toArray(), fov: 38, near: 0.1, far: 200 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => setHovering(false)}
        aria-label="3D scatter of models by release date, ECI and the selected depth axis"
      >
        <color attach="background" args={[bg]} />
        <fog attach="fog" args={[bg, 18, 42]} />
        <ambientLight intensity={dark ? 0.55 : 0.9} />
        <hemisphereLight args={[t.glowB, t.glowA, dark ? 0.55 : 0.3]} />
        <directionalLight position={[6, 10, 8]} intensity={dark ? 1.5 : 1.9} />
        <directionalLight position={[-8, 4, -6]} intensity={0.4} color={t.glowA} />

        <Frame xAxis={xAxis} yAxis={yAxis} zAxis={zAxis} t={t} />
        <Points laid={laid} t={t} reducedMotion={reducedMotion} zLabel={zLabel} onHoverChange={setHovering} />

        <OrbitControls
          ref={controls}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          autoRotate={spinning}
          autoRotateSpeed={0.45}
          enableZoom={engaged}
          zoomSpeed={0.7}
          rotateSpeed={0.7}
          minDistance={6}
          maxDistance={34}
          minPolarAngle={0.12}
          maxPolarAngle={Math.PI * 0.49}
          target={TARGET_ARR}
          onStart={() => {
            window.clearTimeout(resume.current);
            setInteracting(true);
          }}
          onEnd={() => {
            window.clearTimeout(resume.current);
            resume.current = window.setTimeout(() => setInteracting(false), 4000);
          }}
        />
        <Rig resetSignal={resetSignal} reducedMotion={reducedMotion} controls={controls} />
        <TouchPolicy engaged={engaged} />
        <Kick active={active} />

        {dark && (
          <EffectComposer multisampling={4}>
            <Bloom mipmapBlur intensity={0.75} luminanceThreshold={0.72} luminanceSmoothing={0.2} radius={0.7} />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}
