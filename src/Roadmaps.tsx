import React from 'react';
import {
    ActionTooltip,
    Button,
    ClipboardButton,
    Dialog,
    DropdownMenu,
    Icon,
    Label,
    Loader,
    SegmentedRadioGroup,
    Select,
    Text,
    TextArea,
    TextInput,
} from '@gravity-ui/uikit';
import {
    ArrowDownToLine,
    ArrowLeft,
    CircleCheck,
    CircleCheckFill,
    Flag,
    Gear,
    Globe,
    LinkSlash,
    Lock,
    Person,
    Plus,
    TrashBin,
    TriangleExclamation,
    Xmark,
} from '@gravity-ui/icons';

import {AddListItem} from './AddListItem';
import type {Milestone, Roadmap, RoadmapScale, Task} from './types';
import {dayKey, uid} from './types';
import {loadSharedRoadmap} from './store';
import {DescriptionEditor} from './DescriptionEditor';
import {SaveStatus, useAutosave} from './SaveStatus';
import MarkdownIt from 'markdown-it';
import ins from 'markdown-it-ins';
import {exportRoadmap} from './exportXlsx';
import logo from './assets/logo.png';

/* ---------- даты: считаем в днях от 1970-01-01 (UTC), чтобы не мешали часовые пояса ---------- */

const DAY = 864e5;
const toDay = (s: string) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const monthStart = (ym: string) => toDay(ym + '-01');
const monthEnd = (ym: string) => Math.round(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0) / DAY);
const ymOf = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmtDay = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', timeZone: 'UTC'});
const fmtDayYearFull = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
// «2 нояб. 2026» вместо «2 нояб. 2026 г.»: короче и спокойнее на полосе
const fmtDayYear = {format: (d: Date) => fmtDayYearFull.format(d).replace(/\s*г\.$/, '')};

const fmtYm = (ym: string) => `${MONTHS_SHORT[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
export const periodText = (r: Pick<Roadmap, 'scale' | 'from' | 'to'>) =>
    r.scale === 'years' ? `${r.from.slice(0, 4)} – ${r.to.slice(0, 4)}` : `${fmtYm(r.from)} – ${fmtYm(r.to)}`;
export const SCALE_NAMES: Record<RoadmapScale, string> = {months: 'Месяцы', years: 'Годы'};

/** Сроки вехи для подписи: год показываем, только если веха выходит за текущий */
export function datesText(m: Pick<Milestone, 'start' | 'end'>) {
    const s = new Date(toDay(m.start) * DAY);
    const e = new Date(toDay(m.end) * DAY);
    const y = new Date().getFullYear();
    const f = s.getUTCFullYear() === y && e.getUTCFullYear() === y ? fmtDay : fmtDayYear;
    return m.start === m.end ? f.format(s) : `${f.format(s)} – ${f.format(e)}`;
}

/* ---------- гант ---------- */

// ширина дня: месяц около 120 px, год 240 px
const dayPx = (scale: RoadmapScale) => (scale === 'months' ? 4 : 240 / 365.25);

type GanttMap = Pick<Roadmap, 'scale' | 'from' | 'to' | 'milestones'>;

/* ---------- блокировки: веха начинается не раньше, чем закончатся её блокеры ---------- */

export const blockersOf = (m: Milestone, all: Milestone[]) =>
    (m.blockedBy ?? []).map((id) => all.find((x) => x.id === id)).filter((x): x is Milestone => Boolean(x));
export const dependentsOf = (m: Milestone, all: Milestone[]) => all.filter((x) => x.blockedBy?.includes(m.id));

/** В каких днях может лежать веха: после всех блокеров и до начала всех, кого она блокирует. */
function limits(m: Milestone, all: Milestone[], rs: number, re: number) {
    let lo = rs;
    for (const b of blockersOf(m, all)) lo = Math.max(lo, toDay(b.end) + 1);
    let hi = re;
    for (const d of dependentsOf(m, all)) hi = Math.min(hi, toDay(d.start) - 1);
    return {lo, hi};
}

/** Вехи, которые (через цепочку) заблокированы вехой m: их нельзя сделать её блокерами — получится круг. */
function downstream(m: Milestone, all: Milestone[]) {
    const seen = new Set<string>();
    const walk = (x: Milestone) => {
        for (const d of dependentsOf(x, all)) {
            if (!seen.has(d.id)) {
                seen.add(d.id);
                walk(d);
            }
        }
    };
    walk(m);
    return seen;
}

/** Появилась новая блокировка: сдвигаем веху и всё, что за ней, позже, сохраняя длительность. */
function pushLater(all: Milestone[], id: string, re: number): Milestone[] {
    let list = all;
    const visit = (mid: string, depth: number) => {
        const m = list.find((x) => x.id === mid);
        if (!m || depth > all.length) return;
        let lo = -Infinity;
        for (const b of blockersOf(m, list)) lo = Math.max(lo, toDay(b.end) + 1);
        const s = toDay(m.start);
        if (s < lo) {
            const len = toDay(m.end) - s;
            const next = {...m, start: fromDay(Math.min(lo, re)), end: fromDay(Math.min(lo + len, re))};
            list = list.map((x) => (x.id === mid ? next : x));
        }
        for (const d of dependentsOf(m, list)) visit(d.id, depth + 1);
    };
    visit(id, 0);
    return list;
}

export function Gantt({
    roadmap,
    readOnly = false,
    onChange,
    onOpen,
    onAdd,
    meta,
    progress,
}: {
    roadmap: GanttMap;
    readOnly?: boolean;
    /** плюсик «Новая веха» под списком */
    onAdd?: () => void;
    onChange?: (m: Milestone) => void;
    onOpen?: (id: string) => void;
    /** подпись под названием вехи, например сколько задач закрыто */
    meta?: (m: Milestone) => React.ReactNode;
    /** доля закрытых задач вехи (0…1) — заливка полосы; null — задач нет */
    progress?: (m: Milestone) => number | null;
}) {
    const rs = monthStart(roadmap.from);
    const re = monthEnd(roadmap.to);
    const scroller = React.useRef<HTMLDivElement>(null);
    // короткий период растягиваем на всю ширину, длинный прокручивается вбок
    const [room, setRoom] = React.useState(0);
    React.useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const label = () => el.querySelector<HTMLElement>('.mv-gantt__label')?.offsetWidth ?? 0;
        const ro = new ResizeObserver(() => setRoom(el.clientWidth - label()));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const px = Math.max(dayPx(roadmap.scale), room / (re - rs + 1));
    const width = Math.floor((re - rs + 1) * px);
    const x = (d: number) => (d - rs) * px;
    const today = toDay(dayKey());

    // пока тянем полосу, новые сроки живут здесь, а сохраняются, когда отпустили
    const [preview, setPreviewState] = React.useState<{id: string; start: number; end: number} | null>(null);
    const previewRef = React.useRef(preview);
    const setPreview = (v: typeof preview) => {
        previewRef.current = v;
        setPreviewState(v);
    };
    const drag = React.useRef<{
        id: string;
        mode: 'move' | 'start' | 'end';
        x0: number;
        start: number;
        end: number;
        lo: number;
        hi: number;
        moved: boolean;
    } | null>(null);

    // сразу показываем сегодняшний день, если он на карте: на первой четверти, чтобы было видно и прошлое
    const measured = room > 0;
    React.useEffect(() => {
        const el = scroller.current;
        if (el && today >= rs && today <= re) el.scrollLeft = Math.max(0, x(today) - Math.max(room, 0) / 4);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roadmap.from, roadmap.to, roadmap.scale, measured]);
    const hasToday = today >= rs && today <= re;
    const toToday = () =>
        scroller.current?.scrollTo({left: Math.max(0, x(today) - room / 4), behavior: 'smooth'});

    // шкала: сверху годы, снизу месяцы или кварталы
    const years: {key: string; left: number; w: number; label: string}[] = [];
    const cells: {key: string; left: number; w: number; label: string}[] = [];
    for (let y = +roadmap.from.slice(0, 4); y <= +roadmap.to.slice(0, 4); y++) {
        const a = Math.max(rs, toDay(`${y}-01-01`));
        const b = Math.min(re, toDay(`${y}-12-31`));
        years.push({key: String(y), left: x(a), w: (b - a + 1) * px, label: String(y)});
        const step = roadmap.scale === 'months' ? 1 : 3;
        for (let m = 1; m <= 12; m += step) {
            const c0 = Math.max(rs, monthStart(ymOf(y, m)));
            const c1 = Math.min(re, monthEnd(ymOf(y, m + step - 1)));
            if (c0 > c1) continue;
            cells.push({
                key: `${y}-${m}`,
                left: x(c0),
                w: (c1 - c0 + 1) * px,
                label: roadmap.scale === 'months' ? MONTHS_SHORT[m - 1] : `${(m + 2) / 3} кв`,
            });
        }
    }

    const items = [...roadmap.milestones].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

    const down = (e: React.PointerEvent, m: Milestone, mode: 'move' | 'start' | 'end') => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (readOnly) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const {lo, hi} = limits(m, roadmap.milestones, rs, re);
        drag.current = {id: m.id, mode, x0: e.clientX, start: toDay(m.start), end: toDay(m.end), lo, hi, moved: false};
    };
    const move = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x0;
        if (Math.abs(dx) > 3) d.moved = true;
        if (!d.moved) return;
        const days = Math.round(dx / px);
        let {start, end} = d;
        // заблокированную веху не утащить раньше блокера, а блокер — позже того, что он держит
        const {lo, hi} = d;
        if (d.mode === 'move') {
            const len = end - start;
            if (hi - len < lo) return;
            start = Math.min(Math.max(lo, start + days), hi - len);
            end = start + len;
        } else if (d.mode === 'start') {
            start = Math.min(Math.max(lo, start + days), end);
        } else {
            end = Math.max(Math.min(hi, end + days), start);
        }
        setPreview({id: d.id, start, end});
    };
    const up = (m: Milestone) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (!d.moved) {
            onOpen?.(m.id);
            return;
        }
        const p = previewRef.current;
        setPreview(null);
        if (p && p.id === m.id) {
            const next = {...m, start: fromDay(p.start), end: fromDay(p.end)};
            if (next.start !== m.start || next.end !== m.end) onChange?.(next);
        }
    };

    return (
        <div className="mv-gantt" ref={scroller}>
            <div className="mv-gantt__inner" style={{width: `calc(var(--mv-gantt-label) + ${width}px)`}}>
                <div className="mv-gantt__head">
                    <div className="mv-gantt__label mv-gantt__label_head">
                        <Text variant="caption-2" color="secondary">
                            Вехи
                        </Text>
                        {hasToday && width > room + 1 && (
                            <Button view="flat-secondary" size="xs" className="mv-gantt__to-today" onClick={toToday}>
                                К сегодня
                            </Button>
                        )}
                    </div>
                    <div className="mv-gantt__scale" style={{width}}>
                        <div className="mv-gantt__years">
                            {years.map((y) => (
                                <span key={y.key} className="mv-gantt__year" style={{left: y.left, width: y.w}}>
                                    <span className="mv-gantt__year-text">{y.label}</span>
                                </span>
                            ))}
                        </div>
                        <div className="mv-gantt__cells">
                            {cells.map((c) => (
                                <span key={c.key} className="mv-gantt__cell" style={{left: c.left, width: c.w}}>
                                    {c.label}
                                </span>
                            ))}
                        </div>
                        {hasToday && (
                            <span className="mv-gantt__today-pill" style={{left: x(today) + px / 2}}>
                                сегодня
                            </span>
                        )}
                    </div>
                </div>

                <div className="mv-gantt__body">
                    <div className="mv-gantt__grid" style={{left: 'var(--mv-gantt-label)', width}} aria-hidden="true">
                        {cells.map((c) => (
                            <span key={c.key} className="mv-gantt__line" style={{left: c.left}} />
                        ))}
                        {years.map((y) => (
                            <span key={y.key} className="mv-gantt__line mv-gantt__line_year" style={{left: y.left}} />
                        ))}
                        {hasToday && (
                            <>
                                <span className="mv-gantt__past" style={{width: x(today) + px / 2}} />
                                <span className="mv-gantt__today" style={{left: x(today) + px / 2}} title="Сегодня" />
                            </>
                        )}
                    </div>

                    {items.length === 0 && (
                        <div className="mv-gantt__empty">
                            <img src={logo} alt="" />
                            <Text color="secondary">
                                {readOnly ? 'Вех пока нет.' : 'Вех пока нет. Добавьте первую кнопкой «Новая веха» ниже.'}
                            </Text>
                        </div>
                    )}

                    {items.map((m) => {
                        const p = preview && preview.id === m.id ? preview : null;
                        const s = p ? p.start : toDay(m.start);
                        const e = p ? p.end : toDay(m.end);
                        // веха за пределами периода прижимается к краю
                        const a = Math.min(Math.max(s, rs), re);
                        const b = Math.max(Math.min(e, re), a);
                        const left = x(a);
                        const w = Math.max(8, (b - a + 1) * px);
                        const dates = datesText({start: fromDay(s), end: fromDay(e)});
                        // сроки не влезают в короткую полосу: пишем их рядом, справа или, у края карты, слева
                        const textW = dates.length * 6.6 + 24;
                        const short = w < textW;
                        const done = progress?.(m) ?? null;
                        const outside = short ? (left + w + 6 + textW > width ? {right: width - left + 6} : {left: left + w + 6}) : null;
                        return (
                            <div key={m.id} className={`mv-gantt__row${p ? ' mv-gantt__row_drag' : ''}`}>
                                <button
                                    type="button"
                                    className="mv-gantt__label"
                                    onClick={() => onOpen?.(m.id)}
                                    disabled={!onOpen}
                                    title={m.title}
                                >
                                    <span className="mv-gantt__name">{m.title || 'Без названия'}</span>
                                    {meta && <span className="mv-gantt__meta">{meta(m)}</span>}
                                </button>
                                <div className="mv-gantt__track" style={{width}}>
                                    <div
                                        className={`mv-gantt__bar${readOnly ? ' mv-gantt__bar_ro' : ''}${
                                            p ? ' mv-gantt__bar_drag' : ''
                                        }${m.status ? ` mv-gantt__bar_${m.status}` : ''}`}
                                        style={{left, width: w}}
                                        title={`${m.title}: ${dates}${m.status ? ` · ${statusText(m)}` : ''}${
                                            done != null ? ` · задачи закрыты на ${Math.round(done * 100)}%` : ''
                                        }`}
                                        onPointerDown={(ev) => down(ev, m, 'move')}
                                        onPointerMove={move}
                                        onPointerUp={() => up(m)}
                                        onPointerCancel={() => {
                                            drag.current = null;
                                            setPreview(null);
                                        }}
                                        onClick={readOnly && onOpen ? () => onOpen(m.id) : undefined}
                                    >
                                        {done != null && (
                                            <span className="mv-gantt__fill" style={{width: `${done * 100}%`}} aria-hidden="true" />
                                        )}
                                        {!readOnly && (
                                            <span
                                                className="mv-gantt__handle mv-gantt__handle_start"
                                                onPointerDown={(ev) => down(ev, m, 'start')}
                                                onPointerMove={move}
                                                onPointerUp={() => up(m)}
                                                aria-hidden="true"
                                            />
                                        )}
                                        {!short && (
                                            <span className="mv-gantt__dates">
                                                {statusMark(m)}
                                                {dates}
                                            </span>
                                        )}
                                        {!readOnly && (
                                            <span
                                                className="mv-gantt__handle mv-gantt__handle_end"
                                                onPointerDown={(ev) => down(ev, m, 'end')}
                                                onPointerMove={move}
                                                onPointerUp={() => up(m)}
                                                aria-hidden="true"
                                            />
                                        )}
                                    </div>
                                    {outside && (
                                        <span className="mv-gantt__dates mv-gantt__dates_out" style={outside}>
                                            {statusMark(m)}
                                            {dates}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {onAdd && !readOnly && (
                        <div className="mv-gantt__row mv-gantt__row_add">
                            <div className="mv-gantt__label mv-gantt__label_add">
                                <AddListItem onClick={onAdd}>Добавить веху</AddListItem>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ---------- выбор периода ---------- */

function MonthYear({
    value,
    onChange,
    yearOnly,
    label,
}: {
    value: string;
    onChange: (ym: string) => void;
    yearOnly: boolean;
    label: string;
}) {
    const now = new Date().getFullYear();
    const y = +value.slice(0, 4);
    const m = +value.slice(5, 7);
    const yearsList = [];
    for (let i = Math.min(now - 10, y); i <= Math.max(now + 15, y); i++) yearsList.push(i);
    return (
        <span className="mv-period__pick" aria-label={label}>
            {!yearOnly && (
                <Select
                    size="m"
                    width={120}
                    value={[String(m)]}
                    onUpdate={([v]) => onChange(ymOf(y, +v))}
                    options={MONTHS.map((n, i) => ({value: String(i + 1), content: n}))}
                />
            )}
            <Select
                size="m"
                width={88}
                value={[String(y)]}
                onUpdate={([v]) => onChange(ymOf(+v, m))}
                options={yearsList.map((n) => ({value: String(n), content: String(n)}))}
            />
        </span>
    );
}

type Settings = Pick<Roadmap, 'title' | 'scale' | 'from' | 'to'>;

function defaults(scale: RoadmapScale): Pick<Roadmap, 'from' | 'to'> {
    const d = new Date();
    const y = d.getFullYear();
    if (scale === 'years') return {from: ymOf(y, 1), to: ymOf(y + 2, 12)};
    const end = new Date(y, d.getMonth() + 11, 1);
    return {from: ymOf(y, d.getMonth() + 1), to: ymOf(end.getFullYear(), end.getMonth() + 1)};
}

/** Окно создания дорожной карты и её настроек: название, масштаб и период. */
function SettingsDialog({
    open,
    initial,
    onClose,
    onApply,
}: {
    open: boolean;
    /** нет — создаём новую карту */
    initial?: Settings;
    onClose: () => void;
    onApply: (s: Settings) => void;
}) {
    const [s, setS] = React.useState<Settings>(() => initial ?? {title: '', scale: 'months', ...defaults('months')});
    React.useEffect(() => {
        if (open) setS(initial ?? {title: '', scale: 'months', ...defaults('months')});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    const years = s.scale === 'years';
    // в годах период всегда от января до декабря
    const norm = (v: Settings): Settings =>
        v.scale === 'years' ? {...v, from: v.from.slice(0, 4) + '-01', to: v.to.slice(0, 4) + '-12'} : v;
    const valid = s.title.trim() && norm(s).from <= norm(s).to;
    const apply = () => valid && onApply({...norm(s), title: s.title.trim()});
    return (
        <Dialog open={open} onClose={onClose} size="s" aria-label={initial ? 'Настройки дорожной карты' : 'Новая дорожная карта'}>
            <Dialog.Header caption={initial ? 'Настройки дорожной карты' : 'Новая дорожная карта'} />
            <Dialog.Body>
                <div className="mv-period">
                    <TextInput
                        size="l"
                        autoFocus
                        placeholder="Название: проект или продукт"
                        value={s.title}
                        onUpdate={(title) => setS({...s, title})}
                        onKeyDown={(e) => e.key === 'Enter' && apply()}
                    />
                    <div className="mv-period__row">
                        <Text variant="subheader-1">Масштаб</Text>
                        <SegmentedRadioGroup
                            size="m"
                            value={s.scale}
                            onUpdate={(v) => {
                                const scale = v as RoadmapScale;
                                // у новой карты период подбираем под масштаб, у существующей сохраняем
                                setS(norm(initial ? {...s, scale} : {...s, scale, ...defaults(scale)}));
                            }}
                        >
                            <SegmentedRadioGroup.Option value="months">Месяцы</SegmentedRadioGroup.Option>
                            <SegmentedRadioGroup.Option value="years">Годы</SegmentedRadioGroup.Option>
                        </SegmentedRadioGroup>
                    </div>
                    <div className="mv-period__row">
                        <Text variant="subheader-1">Период</Text>
                        <div className="mv-period__range">
                            <Text color="secondary">с</Text>
                            <MonthYear label="Начало" value={s.from} yearOnly={years} onChange={(from) => setS({...s, from})} />
                            <Text color="secondary">по</Text>
                            <MonthYear label="Конец" value={s.to} yearOnly={years} onChange={(to) => setS({...s, to})} />
                        </div>
                    </div>
                    {norm(s).from > norm(s).to && (
                        <Text color="danger" variant="caption-2">
                            Конец периода раньше начала.
                        </Text>
                    )}
                </div>
            </Dialog.Body>
            <Dialog.Footer
                textButtonApply={initial ? 'Сохранить' : 'Создать'}
                textButtonCancel="Отмена"
                propsButtonApply={{disabled: !valid}}
                onClickButtonApply={apply}
                onClickButtonCancel={onClose}
            />
        </Dialog>
    );
}

/* ---------- вкладка «Roadmap» ---------- */

export type RoadmapsProps = {
    roadmaps: Roadmap[] | null;
    tasks: Task[];
    mapId: string | null;
    onOpenMap: (id: string | null) => void;
    milestoneId: string | null;
    onOpenMilestone: (id: string | null) => void;
    canShare: boolean;
    disabled: boolean;
    onSave: (r: Roadmap) => Promise<void> | null;
    onRemove: (r: Roadmap) => void;
    onShare: (id: string) => void;
    onUnshare: (id: string) => void;
    onOpenTask: (id: string) => void;
    onLinkTask: (taskId: string, milestoneId: string | null) => void;
    onToggleTask: (t: Task) => void;
    undoable: (title: string, undo: () => void) => void;
};

export function RoadmapsView(p: RoadmapsProps) {
    const [creating, setCreating] = React.useState(false);
    const map = p.roadmaps?.find((r) => r.id === p.mapId);

    if (p.roadmaps === null) {
        return (
            <div className="mv-loading">
                <Loader size="m" />
                <Text color="secondary">Загружаю дорожные карты…</Text>
            </div>
        );
    }
    if (map) return <RoadmapPage {...p} map={map} />;

    const sorted = [...p.roadmaps].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return (
        <>
            <Text variant="body-1" color="secondary" className="mv-hint">
                Дорожные карты проектов и продуктов: вехи на шкале времени, к вехам можно привязывать задачи.
            </Text>
            {sorted.length === 0 ? (
                <div className="mv-maps-empty">
                    <img src={logo} alt="" className="mv-maps-empty__ant" />
                    <Text color="secondary">Дорожных карт пока нет. Муравей готов прокладывать маршрут.</Text>
                </div>
            ) : (
                <ul className="mv-maps">
                    {sorted.map((r) => (
                        <li key={r.id}>
                            <button type="button" className="mv-map-card" onClick={() => p.onOpenMap(r.id)}>
                                <span className="mv-map-card__title">{r.title}</span>
                                <Text variant="caption-2" color="secondary">
                                    {SCALE_NAMES[r.scale]} · {periodText(r)} · {milestonesWord(r.milestones.length)}
                                </Text>
                                {r.shareId && (
                                    <span className="mv-map-card__shared" title="Открыта по ссылке">
                                        <Icon data={Globe} size={14} />
                                    </span>
                                )}
                                <MiniTimeline map={r} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <AddListItem onClick={() => setCreating(true)} disabled={p.disabled}>
                Добавить дорожную карту
            </AddListItem>
            <SettingsDialog
                open={creating}
                onClose={() => setCreating(false)}
                onApply={(s) => {
                    const r: Roadmap = {id: uid(), ...s, milestones: [], createdAt: new Date().toISOString()};
                    p.onSave(r);
                    setCreating(false);
                    p.onOpenMap(r.id);
                }}
            />
        </>
    );
}

/** Вехи карты одной полоской: видно, как карта выглядит, ещё до того, как её открыли */
function MiniTimeline({map}: {map: Roadmap}) {
    const rs = monthStart(map.from);
    const re = monthEnd(map.to);
    const span = re - rs + 1;
    const pct = (d: number) => `${((Math.min(Math.max(d, rs), re + 1) - rs) / span) * 100}%`;
    const items = [...map.milestones].sort((a, b) => a.start.localeCompare(b.start)).slice(0, 4);
    const today = toDay(dayKey());
    return (
        <span className="mv-map-card__strip" aria-hidden="true">
            {items.map((m, i) => {
                const a = toDay(m.start);
                const b = toDay(m.end) + 1;
                return (
                    <span
                        key={m.id}
                        className={`mv-map-card__strip-bar${m.status ? ` mv-gantt__bar_${m.status}` : ''}`}
                        style={{left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, top: 12 + i * 7}}
                    />
                );
            })}
            <span className="mv-map-card__strip-axis" />
            {today >= rs && today <= re && <span className="mv-map-card__strip-today" style={{left: pct(today)}} />}
        </span>
    );
}

function milestonesWord(n: number) {
    const a = n % 10;
    const b = n % 100;
    const w = a === 1 && b !== 11 ? 'веха' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'вехи' : 'вех';
    return `${n} ${w}`;
}

function RoadmapPage({map, ...p}: RoadmapsProps & {map: Roadmap}) {
    const [title, setTitle] = React.useState(map.title);
    const [settings, setSettings] = React.useState(false);
    const [sharing, setSharing] = React.useState(false);
    const milestone = map.milestones.find((m) => m.id === p.milestoneId);

    // правки накладываем на самую свежую версию карты: текст сохраняется с задержкой
    const mapRef = React.useRef(map);
    mapRef.current = map;
    const saveMap = (patch: Partial<Roadmap>) => p.onSave({...mapRef.current, ...patch});
    const auto = useAutosave<Roadmap>(saveMap);
    const patchMilestone = (id: string, patch: Partial<Milestone>) =>
        saveMap({milestones: mapRef.current.milestones.map((x) => (x.id === id ? {...x, ...patch} : x))});
    const addMilestone = () => {
        const rs = monthStart(map.from);
        const re = monthEnd(map.to);
        const len = map.scale === 'months' ? 29 : 89;
        const start = Math.max(rs, Math.min(toDay(dayKey()), re - len));
        const m: Milestone = {id: uid(), title: 'Новая веха', start: fromDay(start), end: fromDay(Math.min(re, start + len))};
        p.onSave({...map, milestones: [...map.milestones, m]});
        p.onOpenMilestone(m.id);
    };
    const removeMilestone = (m: Milestone) => {
        p.onOpenMilestone(null);
        p.onSave({...map, milestones: map.milestones.filter((x) => x.id !== m.id)});
        p.undoable(`Веха «${m.title}» удалена`, () => p.onSave({...map}));
    };
    const linked = (id: string) => p.tasks.filter((t) => t.milestoneId === id);

    return (
        <div className="mv-map">
            <div className="mv-map__head">
                <Button view="flat" size="m" onClick={() => p.onOpenMap(null)}>
                    <Icon data={ArrowLeft} size={16} />
                    Все карты
                </Button>
                <div className="mv-map__actions">
                    {p.canShare && (
                        <Button view={map.shareId ? 'outlined-info' : 'outlined'} size="m" onClick={() => setSharing(true)}>
                            <Icon data={Globe} size={16} />
                            Поделиться
                        </Button>
                    )}
                    <DropdownMenu
                        size="m"
                        items={[
                            {text: 'Настройки', iconStart: <Icon data={Gear} size={16} />, action: () => setSettings(true)},
                            {
                                text: 'Скачать в Excel',
                                iconStart: <Icon data={ArrowDownToLine} size={16} />,
                                action: () =>
                                    void exportRoadmap(map, `${SCALE_NAMES[map.scale]} · ${periodText(map)}`, (m) =>
                                        linked(m.id),
                                    ),
                            },
                            {
                                text: 'Удалить карту',
                                theme: 'danger',
                                iconStart: <Icon data={TrashBin} size={16} />,
                                action: () => {
                                    p.onOpenMap(null);
                                    p.onRemove(map);
                                },
                            },
                        ]}
                    />
                </div>
            </div>
            <div className="mv-map__titles">
                <TextInput
                    view="clear"
                    size="xl"
                    className="mv-map__title"
                    value={title}
                    onUpdate={(v) => {
                        setTitle(v);
                        if (v.trim()) auto.schedule({title: v.trim()});
                    }}
                    onBlur={() => {
                        if (!title.trim()) setTitle(map.title);
                        auto.flush();
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    aria-label="Название дорожной карты"
                />
                <div className="mv-map__sub">
                    <Text variant="body-1" color="secondary">
                        {SCALE_NAMES[map.scale]} · {periodText(map)} · {milestonesWord(map.milestones.length)}
                    </Text>
                    <SaveStatus state={auto.state} idle="" />
                </div>
            </div>
            <Text variant="caption-2" color="secondary" className="mv-map__hint">
                Тяните полосу, чтобы сдвинуть веху, или её край, чтобы изменить срок.
            </Text>

            <Gantt
                roadmap={map}
                onChange={(m) =>
                    auto.save({milestones: mapRef.current.milestones.map((x) => (x.id === m.id ? m : x))})
                }
                onOpen={(id) => p.onOpenMilestone(id)}
                onAdd={p.disabled ? undefined : addMilestone}
                meta={(m) => {
                    const ts = linked(m.id);
                    return milestoneMeta(
                        m,
                        map.milestones,
                        ts.length > 0 ? {done: ts.filter((t) => t.done).length, total: ts.length} : null,
                    );
                }}
                progress={(m) => {
                    const ts = linked(m.id);
                    return ts.length > 0 ? ts.filter((t) => t.done).length / ts.length : null;
                }}
            />

            <section className="mv-field">
                <Text variant="subheader-1">Описание</Text>
                <DescriptionEditor
                    key={map.id}
                    value={map.description ?? ''}
                    onChange={(v) => auto.schedule({description: v})}
                    onSubmit={auto.flush}
                    placeholder="Цель карты, контекст, что считаем успехом"
                />
            </section>

            <Dialog
                open={Boolean(milestone)}
                onClose={() => p.onOpenMilestone(null)}
                hasCloseButton={false}
                size="m"
                aria-label="Веха"
            >
                {milestone && (
                    <MilestoneDetails
                        key={milestone.id}
                        milestone={milestone}
                        all={map.milestones}
                        scale={map}
                        tasks={linked(milestone.id)}
                        linkable={p.tasks.filter((t) => !t.done && t.milestoneId !== milestone.id)}
                        onSave={(patch) => patchMilestone(milestone.id, patch)}
                        onSaveAll={(list) => saveMap({milestones: list})}
                        onDelete={() => removeMilestone(milestone)}
                        onClose={() => p.onOpenMilestone(null)}
                        onOpenTask={p.onOpenTask}
                        onLinkTask={p.onLinkTask}
                        onToggleTask={p.onToggleTask}
                    />
                )}
            </Dialog>

            <SettingsDialog
                open={settings}
                initial={map}
                onClose={() => setSettings(false)}
                onApply={(s) => {
                    saveMap(s);
                    setTitle(s.title);
                    setSettings(false);
                }}
            />

            <Dialog open={sharing} onClose={() => setSharing(false)} size="s" aria-label="Поделиться">
                <Dialog.Header caption="Ссылка для просмотра" />
                <Dialog.Body>
                    <div className="mv-share">
                        {map.shareId ? (
                            <>
                                <Text color="secondary">
                                    По ссылке карту увидит любой, даже без аккаунта: описание, вехи, сроки, ответственных и
                                    блокировки, но без задач. Менять ничего нельзя.
                                </Text>
                                <TextInput
                                    readOnly
                                    value={shareUrl(map.shareId)}
                                    onFocus={(e) => e.target.select()}
                                    endContent={<ClipboardButton text={shareUrl(map.shareId)} size="s" view="flat" />}
                                />
                                <Button view="outlined-danger" size="m" onClick={() => p.onUnshare(map.id)}>
                                    <Icon data={LinkSlash} size={16} />
                                    Выключить ссылку
                                </Button>
                            </>
                        ) : (
                            <>
                                <Text color="secondary">
                                    Включите ссылку, чтобы показать карту тем, у кого нет аккаунта. Они увидят описание, вехи,
                                    сроки, ответственных и блокировки, но не задачи. Ссылку можно выключить в любой момент.
                                </Text>
                                <Button view="action" size="m" onClick={() => p.onShare(map.id)}>
                                    <Icon data={Globe} size={16} />
                                    Включить ссылку
                                </Button>
                            </>
                        )}
                    </div>
                </Dialog.Body>
            </Dialog>
        </div>
    );
}

/** Подпись под вехой на ганте: ответственный, блокеры и что-то своё */
/** статус вехи одной строкой: для подсказки на ганте */
export function statusText(m: Pick<Milestone, 'status' | 'risk'>) {
    if (m.status === 'done') return 'Готово';
    if (m.status === 'risk') return m.risk?.trim() ? `Под риском: ${m.risk.trim()}` : 'Под риском';
    return 'В работе';
}

const statusMark = (m: Pick<Milestone, 'status'>) => (m.status === 'done' ? '✓ ' : m.status === 'risk' ? '⚠ ' : '');

function milestoneMeta(m: Milestone, all: Milestone[], tasks?: {done: number; total: number} | null) {
    const blockers = blockersOf(m, all);
    const lines: {key: string; icon: typeof Person; text: string; title?: string; tone?: string}[] = [];
    if (m.status === 'done') lines.push({key: 'status', icon: CircleCheckFill, text: 'Готово', tone: 'done'});
    if (m.status === 'risk')
        lines.push({key: 'status', icon: TriangleExclamation, text: m.risk?.trim() || 'Под риском', title: statusText(m), tone: 'risk'});
    if (m.owner) lines.push({key: 'owner', icon: Person, text: m.owner, title: 'Ответственный'});
    if (blockers.length > 0) {
        const text = `после ${blockers.map((b) => `«${b.title}»`).join(', ')}`;
        lines.push({key: 'lock', icon: Lock, text, title: text});
    }
    if (tasks) lines.push({key: 'tasks', icon: CircleCheck, text: `${tasks.done} из ${tasks.total} задач`, title: 'Задач закрыто'});
    return lines.length
        ? lines.map((l) => (
              <span
                  key={l.key}
                  className={`mv-gantt__meta-line${l.tone ? ` mv-gantt__meta-line_${l.tone}` : ''}`}
                  title={l.title}
              >
                  <Icon data={l.icon} size={12} />
                  <span>{l.text}</span>
              </span>
          ))
        : null;
}

const shareUrl = (id: string) => `${window.location.origin}/?roadmap=${id}`;

function MilestoneDetails({
    milestone,
    all,
    scale,
    tasks,
    linkable,
    onSave,
    onSaveAll,
    onDelete,
    onClose,
    onOpenTask,
    onLinkTask,
    onToggleTask,
}: {
    milestone: Milestone;
    /** все вехи карты — для блокировок */
    all: Milestone[];
    scale: Pick<Roadmap, 'from' | 'to'>;
    tasks: Task[];
    linkable: Task[];
    /** правка этой вехи; берёт свежую версию вехи и накладывает изменения */
    onSave: (p: Partial<Milestone>) => Promise<void> | null;
    /** правка сразу нескольких вех (блокировка сдвигает следующие) */
    onSaveAll: (list: Milestone[]) => Promise<void> | null;
    onDelete: () => void;
    onClose: () => void;
    onOpenTask: (id: string) => void;
    onLinkTask: (taskId: string, milestoneId: string | null) => void;
    onToggleTask: (t: Task) => void;
}) {
    const [title, setTitle] = React.useState(milestone.title);
    const [owner, setOwner] = React.useState(milestone.owner ?? '');
    const [risk, setRisk] = React.useState(milestone.risk ?? '');
    const auto = useAutosave<Milestone>(onSave);
    // сохранение нескольких вех показываем в том же статусе
    const allAuto = useAutosave<{list: Milestone[]}>((p) => (p.list ? onSaveAll(p.list) : null));
    const status = allAuto.state.kind !== 'idle' && auto.state.kind === 'idle' ? allAuto.state : auto.state;

    const rs = monthStart(scale.from);
    const re = monthEnd(scale.to);
    const {lo, hi} = limits(milestone, all, rs, re);
    const setDate = (k: 'start' | 'end', v: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
        // блокер не пускает начало раньше себя, а заблокированные — конец позже их начала
        const d = k === 'start' ? Math.max(toDay(v), lo) : Math.min(toDay(v), hi);
        const next = {start: milestone.start, end: milestone.end, [k]: fromDay(d)};
        // начало не позже конца: двигаем второй край следом
        if (next.start > next.end) {
            if (k === 'start') next.end = next.start;
            else next.start = next.end;
        }
        auto.save(next);
    };

    const blockers = blockersOf(milestone, all);
    const blocks = dependentsOf(milestone, all);
    const loop = downstream(milestone, all);
    const candidates = all.filter((x) => x.id !== milestone.id && !milestone.blockedBy?.includes(x.id) && !loop.has(x.id));
    const addBlocker = (id: string) => {
        const list = all.map((x) => (x.id === milestone.id ? {...x, blockedBy: [...blockers.map((b) => b.id), id]} : x));
        allAuto.save({list: pushLater(list, milestone.id, re)});
    };
    const removeBlocker = (id: string) => auto.save({blockedBy: blockers.map((b) => b.id).filter((x) => x !== id)});
    const open = tasks.filter((t) => !t.done).length;
    const close = () => {
        auto.flush();
        onClose();
    };

    return (
        <div className="mv-details mv-details_popup">
            <div className="mv-details__head">
                <Label theme="info" size="s" icon={<Icon data={Flag} size={12} />}>
                    Веха
                </Label>
                <SaveStatus state={status} idle={datesText(milestone)} />
                <div className="mv-details__actions">
                    <ActionTooltip title="Удалить веху">
                        <Button view="flat-danger" size="m" onClick={onDelete} aria-label="Удалить веху">
                            <Icon data={TrashBin} size={16} />
                        </Button>
                    </ActionTooltip>
                </div>
                <Button view="flat" size="m" onClick={close} aria-label="Закрыть" className="mv-details__close">
                    <Icon data={Xmark} size={16} />
                </Button>
            </div>

            <TextInput
                view="clear"
                size="xl"
                className="mv-map__title"
                value={title}
                onUpdate={(v) => {
                    setTitle(v);
                    if (v.trim()) auto.schedule({title: v.trim()});
                }}
                onBlur={() => {
                    if (!title.trim()) setTitle(milestone.title);
                    auto.flush();
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                placeholder="Название вехи"
                aria-label="Название вехи"
            />

            <section className="mv-field">
                <Text variant="subheader-1">Сроки</Text>
                <div className="mv-dates">
                    <label className="mv-date-field">
                        <Text variant="caption-2" color="secondary">
                            Начало
                        </Text>
                        <input
                            type="date"
                            value={milestone.start}
                            min={fromDay(lo)}
                            max={fromDay(re)}
                            onChange={(e) => setDate('start', e.target.value)}
                        />
                    </label>
                    <label className="mv-date-field">
                        <Text variant="caption-2" color="secondary">
                            Конец
                        </Text>
                        <input
                            type="date"
                            value={milestone.end}
                            min={fromDay(rs)}
                            max={fromDay(hi)}
                            onChange={(e) => setDate('end', e.target.value)}
                        />
                    </label>
                </div>
            </section>

            <section className="mv-field">
                <Text variant="subheader-1">Статус</Text>
                <SegmentedRadioGroup
                    size="m"
                    value={milestone.status ?? 'work'}
                    onUpdate={(v) => auto.save({status: v === 'work' ? undefined : (v as Milestone['status'])})}
                    options={[
                        {value: 'work', content: 'В работе'},
                        {value: 'done', content: '✓ Готово'},
                        {value: 'risk', content: '⚠ Под риском'},
                    ]}
                />
                {milestone.status === 'risk' && (
                    <TextArea
                        size="m"
                        minRows={2}
                        maxRows={8}
                        value={risk}
                        onUpdate={(v) => {
                            setRisk(v);
                            auto.schedule({risk: v.trim()});
                        }}
                        onBlur={auto.flush}
                        placeholder="В чём риск и что с ним делаем"
                        aria-label="Описание риска"
                    />
                )}
            </section>

            <section className="mv-field">
                <Text variant="subheader-1">Ответственный</Text>
                <TextInput
                    size="m"
                    value={owner}
                    onUpdate={(v) => {
                        setOwner(v);
                        auto.schedule({owner: v.trim()});
                    }}
                    onBlur={auto.flush}
                    placeholder="Кто отвечает за веху"
                    aria-label="Ответственный"
                />
            </section>

            <section className="mv-field">
                <Text variant="subheader-1">Блокируется вехами</Text>
                {blockers.length > 0 ? (
                    <ul className="mv-subtasks">
                        {blockers.map((b) => (
                            <li key={b.id} className="mv-subtask">
                                <span className="mv-blocker__icon" aria-hidden="true">
                                    <Icon data={Lock} size={14} />
                                </span>
                                <span className="mv-subtask__title mv-blocker__title">
                                    {b.title}
                                    <Text variant="caption-2" color="secondary">
                                        {' '}
                                        · до {fmtDayYear.format(new Date(toDay(b.end) * DAY))}
                                    </Text>
                                </span>
                                <ActionTooltip title="Снять блокировку">
                                    <Button
                                        view="flat-secondary"
                                        size="s"
                                        className="mv-subtask__unlink"
                                        onClick={() => removeBlocker(b.id)}
                                        aria-label={`Снять блокировку «${b.title}»`}
                                    >
                                        <Icon data={LinkSlash} size={14} />
                                    </Button>
                                </ActionTooltip>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Text color="secondary" className="mv-subtasks__empty">
                        Веху можно начать, только когда закончатся вехи, которые её блокируют. Раньше них её не перетащить.
                    </Text>
                )}
                {candidates.length > 0 && (
                    <div>
                        <Select
                            value={[]}
                            filterable={candidates.length > 7}
                            filterPlaceholder="Найти веху"
                            popupWidth={320}
                            onUpdate={([v]) => v && addBlocker(v)}
                            options={candidates.map((x) => ({value: x.id, content: x.title}))}
                            renderControl={({ref, triggerProps}) => (
                                <Button ref={ref as React.Ref<HTMLButtonElement>} {...triggerProps} view="outlined" size="m">
                                    <Icon data={Lock} size={16} />
                                    Добавить блокирующую веху
                                </Button>
                            )}
                        />
                    </div>
                )}
                {blocks.length > 0 && (
                    <Text variant="caption-2" color="secondary">
                        Эта веха блокирует: {blocks.map((x) => `«${x.title}»`).join(', ')}.
                    </Text>
                )}
            </section>

            <section className="mv-field">
                <div className="mv-subtasks__head">
                    <Text variant="subheader-1">Задачи</Text>
                    {tasks.length > 0 && (
                        <Text variant="caption-2" color="secondary">
                            открыто {open} из {tasks.length}
                        </Text>
                    )}
                </div>
                {tasks.length > 0 ? (
                    <ul className="mv-subtasks">
                        {tasks.map((c) => (
                            <li key={c.id} className={`mv-subtask${c.done ? ' mv-subtask_done' : ''}`}>
                                <button
                                    type="button"
                                    className={`mv-check mv-check_s${c.done ? ' mv-check_on' : ''}`}
                                    aria-label={c.done ? 'Вернуть в работу' : 'Закрыть задачу'}
                                    onClick={() => onToggleTask(c)}
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M6 12.5l4 4 8-9" />
                                    </svg>
                                </button>
                                <button type="button" className="mv-subtask__title" onClick={() => onOpenTask(c.id)}>
                                    {c.title}
                                </button>
                                <ActionTooltip title="Отвязать от вехи">
                                    <Button
                                        view="flat-secondary"
                                        size="s"
                                        className="mv-subtask__unlink"
                                        onClick={() => onLinkTask(c.id, null)}
                                        aria-label={`Отвязать «${c.title}»`}
                                    >
                                        <Icon data={LinkSlash} size={14} />
                                    </Button>
                                </ActionTooltip>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Text color="secondary" className="mv-subtasks__empty">
                        Привяжите задачи, которые ведут к этой вехе. Привязать можно и из карточки задачи, в поле «Веха».
                    </Text>
                )}
                {linkable.length > 0 && (
                    <div>
                        <Select
                            value={[]}
                            filterable={linkable.length > 7}
                            filterPlaceholder="Найти задачу"
                            popupWidth={320}
                            onUpdate={([v]) => v && onLinkTask(v, milestone.id)}
                            options={linkable.map((t) => ({value: t.id, content: t.title}))}
                            renderControl={({ref, triggerProps}) => (
                                <Button ref={ref as React.Ref<HTMLButtonElement>} {...triggerProps} view="outlined" size="m">
                                    <Icon data={Plus} size={16} />
                                    Привязать задачу
                                </Button>
                            )}
                        />
                    </div>
                )}
            </section>
        </div>
    );
}

/* ---------- просмотр по публичной ссылке ---------- */

// описание по ссылке показываем готовым текстом; html в markdown не пропускаем
const md = new MarkdownIt({html: false, linkify: true, breaks: true}).use(ins);
const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, self) => self.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
    tokens[i].attrSet('target', '_blank');
    tokens[i].attrSet('rel', 'noopener noreferrer');
    return defaultLink(tokens, i, opts, env, self);
};

function Markdown({text}: {text: string}) {
    return <div className="mv-md" dangerouslySetInnerHTML={{__html: md.render(text)}} />;
}

/** Веха по публичной ссылке: только чтение, без задач */
function MilestoneView({milestone, all, onOpen}: {milestone: Milestone; all: Milestone[]; onOpen: (id: string) => void}) {
    const blockers = blockersOf(milestone, all);
    const blocks = dependentsOf(milestone, all);
    const links = (list: Milestone[]) =>
        list.map((x, i) => (
            <React.Fragment key={x.id}>
                {i > 0 && ', '}
                <button type="button" className="mv-ms-link" onClick={() => onOpen(x.id)}>
                    {x.title}
                </button>
            </React.Fragment>
        ));
    return (
        <div className="mv-details mv-details_popup">
            <div className="mv-details__head">
                <Label theme="info" size="s" icon={<Icon data={Flag} size={12} />}>
                    Веха
                </Label>
            </div>
            <Text variant="header-1" as="h2" className="mv-ms-title">
                {milestone.title}
            </Text>
            <section className="mv-field">
                <Text variant="subheader-1">Сроки</Text>
                <Text>{datesText(milestone)}</Text>
            </section>
            <section className="mv-field">
                <Text variant="subheader-1">Статус</Text>
                <Text>
                    {milestone.status === 'done' ? '✓ Готово' : milestone.status === 'risk' ? '⚠ Под риском' : 'В работе'}
                </Text>
                {milestone.status === 'risk' && milestone.risk?.trim() && (
                    <Text className="mv-risk-text">{milestone.risk.trim()}</Text>
                )}
            </section>
            {milestone.owner && (
                <section className="mv-field">
                    <Text variant="subheader-1">Ответственный</Text>
                    <Text>{milestone.owner}</Text>
                </section>
            )}
            {blockers.length > 0 && (
                <section className="mv-field">
                    <Text variant="subheader-1">Блокируется вехами</Text>
                    <Text>{links(blockers)}</Text>
                </section>
            )}
            {blocks.length > 0 && (
                <section className="mv-field">
                    <Text variant="subheader-1">Блокирует</Text>
                    <Text>{links(blocks)}</Text>
                </section>
            )}
        </div>
    );
}

export function SharedRoadmap({id}: {id: string}) {
    const [openId, setOpenId] = React.useState<string | null>(null);
    type Shared = Awaited<ReturnType<typeof loadSharedRoadmap>>;
    const [state, setState] = React.useState<{kind: 'loading'} | {kind: 'error'} | {kind: 'ready'; map: Shared}>({
        kind: 'loading',
    });
    React.useEffect(() => {
        loadSharedRoadmap(id).then(
            (map) => {
                setState({kind: 'ready', map});
                if (map) document.title = `${map.title} – Муравей`;
            },
            () => setState({kind: 'error'}),
        );
    }, [id]);
    return (
        <div className="mv-app mv-app_wide">
            <header className="mv-header">
                <div className="mv-brand">
                    <img src={logo} alt="" className="mv-mark" />
                    <div>
                        <Text variant="header-1" as="h1" className="mv-title">
                            {state.kind === 'ready' && state.map ? state.map.title : 'Дорожная карта'}
                        </Text>
                        {state.kind === 'ready' && state.map && (
                            <Text variant="body-1" color="secondary" className="mv-date">
                                {SCALE_NAMES[state.map.scale]} · {periodText(state.map)}
                            </Text>
                        )}
                    </div>
                </div>
                {state.kind === 'ready' && state.map && (
                    <Button
                        view="outlined"
                        size="m"
                        onClick={() => {
                            const map = state.map!;
                            void exportRoadmap(map, `${SCALE_NAMES[map.scale]} · ${periodText(map)}`);
                        }}
                    >
                        <Icon data={ArrowDownToLine} size={16} />
                        Скачать .xlsx
                    </Button>
                )}
            </header>
            <main className="mv-main">
                {state.kind === 'loading' ? (
                    <div className="mv-loading">
                        <Loader size="m" />
                        <Text color="secondary">Загружаю дорожную карту…</Text>
                    </div>
                ) : state.kind === 'error' ? (
                    <div className="mv-empty">
                        <Text color="secondary">Не получилось загрузить карту. Проверьте интернет и обновите страницу.</Text>
                    </div>
                ) : !state.map ? (
                    <div className="mv-empty">
                        <Text color="secondary">Ссылка больше не работает: её выключили или карту удалили.</Text>
                    </div>
                ) : (
                    <>
                        <Gantt
                            roadmap={state.map}
                            readOnly
                            onOpen={setOpenId}
                            meta={(m) => milestoneMeta(m, (state.map as GanttMap).milestones)}
                        />
                        {state.map.description?.trim() && <Markdown text={state.map.description} />}
                    </>
                )}
            </main>
            <Text variant="caption-2" color="secondary" className="mv-footnote">
                Только просмотр. Сделано в Муравье.
            </Text>
            {(() => {
                const all = state.kind === 'ready' && state.map ? state.map.milestones : [];
                const m = all.find((x) => x.id === openId);
                return (
                    <Dialog open={Boolean(m)} onClose={() => setOpenId(null)} size="m" aria-label="Веха">
                        {m && <MilestoneView key={m.id} milestone={m} all={all} onOpen={setOpenId} />}
                    </Dialog>
                );
            })()}
        </div>
    );
}
