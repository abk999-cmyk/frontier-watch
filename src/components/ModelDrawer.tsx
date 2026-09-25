import { useEffect, useMemo, useState } from 'react';
import { textMatch } from '../lib/filters.ts';
import { MultiSelect, SearchInput, SingleSelect } from './filters/Filters.tsx';
import { BENCH_GROUP_ORDER, type BenchGroup } from '../../shared/types.ts';
import { useCore, useScores } from '../lib/data.ts';
import { fmtBench, fmtFlop, shortDate } from '../lib/format.ts';
import { LAB_META, LAB_NAME, labVar } from '../lib/labs.ts';
import { bestRecord, indexScores } from '../lib/scores.ts';
import { openModel, useSelectedModel } from '../lib/ui-state.ts';
import { Drawer } from './ui/misc.tsx';

export const GROUP_LABEL: Record<BenchGroup, string> = {
  hle: "Humanity's Last Exam",
  swe: 'Software engineering',
  agentic: 'Agentic',
  science: 'Science',
  math: 'Math',
  bio: 'Biology',
  index: 'Indices & reasoning',
};

export function ModelDrawer() {
  const id = useSelectedModel();
  const core = useCore();
  const { records } = useScores();
  const idx = useMemo(() => indexScores(records), [records]);
  const model = core.models.find((m) => m.id === id);
  const sv = model?.scalingVector ? core.scalingVectors.find((s) => s.id === model.scalingVector) : undefined;
  const parent = model?.variantOf ? core.models.find((m) => m.id === model.variantOf) : undefined;
  const mine = model ? idx.get(model.id) : undefined;

  // Per-model result filters (reset whenever a different model opens).
  const [q, setQ] = useState('');
  const [prov, setProv] = useState<'any' | 'independent' | 'lab'>('any');
  const [groups, setGroups] = useState<string[]>([]);
  useEffect(() => {
    setQ('');
    setProv('any');
    setGroups([]);
  }, [id]);
  const groupOptions = BENCH_GROUP_ORDER.filter((g) => core.benchmarks.some((b) => b.group === g && mine?.has(b.id))).map((g) => ({
    value: g,
    label: GROUP_LABEL[g],
    count: core.benchmarks.filter((b) => b.group === g && mine?.has(b.id)).length,
  }));

  return (
    <Drawer
      open={!!model}
      onClose={() => openModel(null)}
      kicker={model && <span style={{ color: labVar(model.labGroup) }}>{LAB_META[model.labGroup].glyph} {LAB_NAME[model.lab]}</span>}
      title={model?.name}
    >
      {model && (
        <div className="space-y-6 text-[13px]">
          <div className="flex flex-wrap gap-2">
            <Tag>{shortDate(model.released)}</Tag>
            <Tag>{model.status}</Tag>
            {model.tier === 'variant' && parent && <Tag>variant of {parent.name}</Tag>}
            {model.openWeights && <Tag>open weights</Tag>}
            {model.pretrain && <Tag accent>◆ new pre-train</Tag>}
            {sv && <Tag accent>⚡ {sv.name}</Tag>}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact k="Epoch Capabilities Index" v={model.eci ? `${model.eci.value.toFixed(1)}  (${model.eci.low.toFixed(0)}–${model.eci.high.toFixed(0)})` : '—'} />
            <Fact k="Training compute" v={model.trainingFlop ? `${fmtFlop(model.trainingFlop)} FLOP` : '—'} />
            <Fact k="Parameters" v={model.params ?? '—'} />
            <Fact k="Pre-train" v={model.pretrain === true ? 'new base model' : model.pretrain === false ? 'post-train of existing base' : 'undisclosed'} />
          </dl>
          {model.pretrainNote && <p className="text-ink-2">{model.pretrainNote}</p>}
          {sv && (
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <div className="kicker mb-1">⚡ New scaling vector</div>
              <div className="font-medium">{sv.name}</div>
              <p className="mt-1 text-ink-2">{sv.summary}</p>
            </div>
          )}

          {mine && mine.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput value={q} onChange={setQ} placeholder="Search this model's results…" className="w-full" />
              <MultiSelect label="Groups" options={groupOptions} value={groups} onChange={setGroups} />
              <SingleSelect
                label="Source"
                value={prov}
                defaultValue="any"
                onChange={setProv}
                options={[
                  { value: 'any', label: 'Any source' },
                  { value: 'independent', label: '● Independent only' },
                  { value: 'lab', label: '○ Lab-reported only' },
                ]}
              />
            </div>
          )}

          {BENCH_GROUP_ORDER.filter((g) => !groups.length || groups.includes(g)).map((g) => {
            const rows = core.benchmarks.filter(
              (b) => b.group === g && mine?.has(b.id) && textMatch(`${b.name} ${b.short} ${b.description ?? ''}`, q) && (prov === 'any' || mine.get(b.id)!.some((r) => r.prov === prov)),
            );
            if (!rows.length) return null;
            return (
              <div key={g}>
                <div className="kicker mb-2">{GROUP_LABEL[g]}</div>
                <div className="divide-y divide-line rounded-xl border border-line">
                  {rows.map((b) => {
                    const r = bestRecord(mine!.get(b.id), b, { prov })!;
                    const n = mine!.get(b.id)!.length;
                    return (
                      <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <div className="font-medium">{b.name}</div>
                          <div className="text-[11.5px] text-ink-3">
                            {r.prov === 'independent' ? '● independent' : '○ lab-reported'}
                            {r.tools ? ' · 🔧 tools' : ''}
                            {r.effort ? ` · effort ${r.effort}` : ''}
                            {n > 1 ? ` · ${n} results` : ''}
                          </div>
                        </div>
                        <a href={r.url} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[13px] font-semibold tnum hover:underline">
                          {fmtBench(r.v, b)}
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {!!model.sources?.length && (
            <div>
              <div className="kicker mb-2">Sources</div>
              <ul className="space-y-1">
                {model.sources.map((s) => (
                  <li key={s}>
                    <a className="break-all text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink" href={s} target="_blank" rel="noreferrer">
                      {s}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <span className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${accent ? 'border-[color-mix(in_oklab,var(--accent)_45%,transparent)] bg-[var(--accent-soft)] text-ink' : 'border-line text-ink-2'}`}>{children}</span>;
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="kicker mb-0.5">{k}</dt>
      <dd className="font-mono text-[13px] text-ink">{v}</dd>
    </div>
  );
}
