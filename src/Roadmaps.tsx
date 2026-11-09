import React from 'react';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCenter,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type {DragEndEvent} from '@dnd-kit/core';
import {sortableKeyboardCoordinates} from '@dnd-kit/sortable';
import {
    ActionTooltip,
    Button,
    ClipboardButton,
    Dialog,
    DropdownMenu,
    Icon,
    Label,
    Loader,
    Menu,
    Popup,
    SegmentedRadioGroup,
    Select,
    Slider,
    Text,
    TextArea,
    TextInput,
} from '@gravity-ui/uikit';
import {
    ArrowDownToLine,
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    CircleCheck,
    CircleCheckFill,
    CopyPlus,
    Flag,
    Gear,
    Globe,
    Grip,
    Layers,
    LinkSlash,
    Lock,
    MagnifierMinus,
    MagnifierPlus,
    Pencil,
    Person,
    Plus,
    TrashBin,
    TriangleExclamation,
    Xmark,
} from '@gravity-ui/icons';

import {AddListItem} from './AddListItem';
import {DateField} from './DateField';
import {TaskPicker} from './TaskPicker';
import type {Deadline, Epic, Milestone, Roadmap, RoadmapScale, Tag, Task} from './types';
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
export const SCALE_NAMES: Record<RoadmapScale, string> = {weeks: 'Недели', months: 'Месяцы', years: 'Годы'};

/** Сроки вехи для подписи: год показываем, только если веха выходит за текущий */
export function datesText(m: Pick<Milestone, 'start' | 'end'>) {
    const s = new Date(toDay(m.start) * DAY);
    const e = new Date(toDay(m.end) * DAY);
    const y = new Date().getFullYear();
    const f = s.getUTCFullYear() === y && e.getUTCFullYear() === y ? fmtDay : fmtDayYear;
    return m.start === m.end ? f.format(s) : `${f.format(s)} – ${f.format(e)}`;
}

/* ---------- гант ---------- */

// неделя около 84 px, месяц около 120 px, год 240 px
const dayPx = (scale: RoadmapScale) => (scale === 'weeks' ? 12 : scale === 'months' ? 4 : 240 / 365.25);

const barColor = (m: Pick<Milestone, 'color'>): React.CSSProperties =>
    m.color && /^#[\da-f]{6}$/i.test(m.color)
        ? ({
              '--mv-gantt-bar-line': m.color,
              '--mv-gantt-bar': `color-mix(in srgb, ${m.color} 28%, transparent)`,
          } as React.CSSProperties)
        : {};

type GanttMap = Pick<Roadmap, 'scale' | 'from' | 'to' | 'milestones' | 'epics' | 'deadlines'>;

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

const ZOOM_KEY = 'muravey:roadmap-zoom';
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;

function initialZoom() {
    try {
        const value = Number(localStorage.getItem(ZOOM_KEY));
        return Number.isFinite(value) && value >= MIN_ZOOM && value <= MAX_ZOOM ? value : 100;
    } catch {
        return 100;
    }
}

function MilestoneLabel({
    milestone,
    nested,
    draggable,
    onOpen,
    meta,
}: {
    milestone: Milestone;
    nested: boolean;
    draggable: boolean;
    onOpen?: (id: string) => void;
    meta?: React.ReactNode;
}) {
    const drag = useDraggable({id: milestone.id, disabled: !draggable});
    return (
        <div
            ref={drag.setNodeRef}
            className={`mv-gantt__label mv-gantt__label_milestone${nested ? ' mv-gantt__label_nested' : ''}${
                drag.isDragging ? ' mv-gantt__label_dragging' : ''
            }`}
        >
            <button
                type="button"
                className="mv-gantt__open"
                onClick={() => onOpen?.(milestone.id)}
                disabled={!onOpen}
                title={milestone.title}
            >
                <span className="mv-gantt__name">{milestone.title || 'Без названия'}</span>
                {meta && <span className="mv-gantt__meta">{meta}</span>}
            </button>
            {draggable && (
                <ActionTooltip title="Перетащить в другой эпик">
                    <button
                        ref={drag.setActivatorNodeRef}
                        type="button"
                        className="mv-gantt__drag-handle"
                        {...drag.attributes}
                        {...drag.listeners}
                        aria-label={`Перетащить веху «${milestone.title}» в другой эпик`}
                        aria-roledescription="перетаскиваемая веха"
                        data-milestone-drag={milestone.id}
                    >
                        <Icon data={Grip} size={15} />
                    </button>
                </ActionTooltip>
            )}
        </div>
    );
}

function EpicDropRow({
    epicId,
    disabled,
    children,
}: {
    epicId: string | null;
    disabled: boolean;
    children: React.ReactNode;
}) {
    const drop = useDroppable({id: `epic:${epicId ?? ''}`, disabled});
    return (
        <div
            ref={drop.setNodeRef}
            className={`mv-gantt__row mv-gantt__row_epic${drop.isOver ? ' mv-gantt__row_drop' : ''}`}
            data-epic-id={epicId ?? ''}
        >
            {children}
        </div>
    );
}

export function Gantt({
    roadmap,
    readOnly = false,
    onChange,
    onMoveToEpic,
    onOpen,
    onRename,
    onDuplicate,
    onAdd,
    onOpenEpic,
    onAddEpic,
    onOpenDeadline,
    onAddDeadline,
    meta,
    progress,
}: {
    roadmap: GanttMap;
    readOnly?: boolean;
    onAdd?: () => void;
    onChange?: (m: Milestone) => void;
    onMoveToEpic?: (id: string, epicId: string | null) => void;
    onOpen?: (id: string) => void;
    onRename?: (id: string, title: string) => void;
    onDuplicate?: (m: Milestone) => void;
    onOpenEpic?: (id: string) => void;
    onAddEpic?: () => void;
    onOpenDeadline?: (id: string) => void;
    onAddDeadline?: () => void;
    /** подпись под названием вехи, например сколько задач закрыто */
    meta?: (m: Milestone) => React.ReactNode;
    /** доля закрытых задач вехи (0…1) — заливка полосы; null — задач нет */
    progress?: (m: Milestone) => number | null;
}) {
    const rs = monthStart(roadmap.from);
    const re = monthEnd(roadmap.to);
    const scroller = React.useRef<HTMLDivElement>(null);
    const contextAnchor = React.useRef<HTMLDivElement>(null);
    const [room, setRoom] = React.useState(0);
    const [zoom, setZoom] = React.useState(initialZoom);
    const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
    const [activeId, setActiveId] = React.useState<string | null>(null);
    const [contextMenu, setContextMenu] = React.useState<{id: string; x: number; y: number} | null>(null);
    const [renaming, setRenaming] = React.useState(false);
    const [contextTitle, setContextTitle] = React.useState('');
    const zoomAnchor = React.useRef<number | null>(null);
    const sensors = useSensors(
        useSensor(MouseSensor, {activationConstraint: {distance: 5}}),
        useSensor(TouchSensor, {activationConstraint: {delay: 200, tolerance: 6}}),
        useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}),
    );
    React.useEffect(() => {
        try {
            localStorage.setItem(ZOOM_KEY, String(zoom));
        } catch {
            /* масштаб просто не сохранится между открытиями */
        }
    }, [zoom]);
    React.useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const label = () => el.querySelector<HTMLElement>('.mv-gantt__label')?.offsetWidth ?? 0;
        const ro = new ResizeObserver(() => setRoom(el.clientWidth - label()));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    // при 100% короткий период по-прежнему занимает всю ширину, длинный прокручивается
    const px = Math.max(dayPx(roadmap.scale), room / (re - rs + 1)) * (zoom / 100);
    const width = Math.floor((re - rs + 1) * px);
    const x = (d: number) => (d - rs) * px;
    const today = toDay(dayKey());
    const changeZoom = (value: number) => {
        const el = scroller.current;
        if (el && room > 0) zoomAnchor.current = rs + (el.scrollLeft + room / 2) / px;
        setZoom(value);
    };
    React.useLayoutEffect(() => {
        const el = scroller.current;
        if (el && zoomAnchor.current !== null) {
            el.scrollLeft = Math.max(0, x(zoomAnchor.current) - room / 2);
            zoomAnchor.current = null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [zoom]);

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

    // шкала: сверху годы, снизу недели, месяцы или кварталы
    const years: {key: string; left: number; w: number; label: string}[] = [];
    const cells: {key: string; left: number; w: number; label: string}[] = [];
    for (let y = +roadmap.from.slice(0, 4); y <= +roadmap.to.slice(0, 4); y++) {
        const a = Math.max(rs, toDay(`${y}-01-01`));
        const b = Math.min(re, toDay(`${y}-12-31`));
        years.push({key: String(y), left: x(a), w: (b - a + 1) * px, label: String(y)});
    }
    if (roadmap.scale === 'weeks') {
        // недели начинаются с понедельника; 1970-01-01 — четверг
        for (let a = rs - ((rs + 3) % 7); a <= re; a += 7) {
            const c0 = Math.max(rs, a);
            const c1 = Math.min(re, a + 6);
            const d = new Date(a * DAY);
            cells.push({
                key: String(a),
                left: x(c0),
                w: (c1 - c0 + 1) * px,
                label: `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`,
            });
        }
    } else {
        for (let y = +roadmap.from.slice(0, 4); y <= +roadmap.to.slice(0, 4); y++) {
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
    }

    const items = [...roadmap.milestones].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const epics = roadmap.epics ?? [];
    const deadlines = [...(roadmap.deadlines ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const ungrouped = items.filter((m) => !epics.some((e) => e.id === m.epicId));
    const canDrag = !readOnly && Boolean(onMoveToEpic) && epics.length > 0;
    const activeMilestone = items.find((m) => m.id === activeId);
    const contextMilestone = items.find((m) => m.id === contextMenu?.id);
    const groupKeys = [...epics.map((e) => e.id), ''];
    const allCollapsed = groupKeys.every((id) => collapsed.has(id));
    const toggleGroup = (id: string) =>
        setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groupKeys));
    const finishMove = ({active, over}: DragEndEvent) => {
        setActiveId(null);
        if (!over) return;
        const dropId = String(over.id);
        if (!dropId.startsWith('epic:')) return;
        const id = String(active.id);
        const milestone = roadmap.milestones.find((m) => m.id === id);
        const epicId = dropId.slice(5) || null;
        if (milestone && (milestone.epicId ?? null) !== epicId) onMoveToEpic?.(id, epicId);
    };
    const showContextMenu = (e: React.MouseEvent, m: Milestone) => {
        if (readOnly || (!onRename && !onDuplicate)) return;
        e.preventDefault();
        e.stopPropagation();
        setContextTitle(m.title);
        setRenaming(false);
        setContextMenu({id: m.id, x: e.clientX, y: e.clientY});
    };
    const closeContextMenu = () => {
        setContextMenu(null);
        setRenaming(false);
    };
    const renameMilestone = () => {
        const title = contextTitle.trim();
        if (!contextMilestone || !title) return;
        if (title !== contextMilestone.title) onRename?.(contextMilestone.id, title);
        closeContextMenu();
    };

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

    const renderMilestone = (m: Milestone) => {
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
            <div
                key={m.id}
                className={`mv-gantt__row${p ? ' mv-gantt__row_drag' : ''}`}
                onContextMenu={(event) => showContextMenu(event, m)}
            >
                <MilestoneLabel
                    milestone={m}
                    nested={epics.length > 0}
                    draggable={canDrag}
                    onOpen={onOpen}
                    meta={meta?.(m)}
                />
                <div className="mv-gantt__track" style={{width}}>
                    <div
                        className={`mv-gantt__bar${readOnly ? ' mv-gantt__bar_ro' : ''}${
                            p ? ' mv-gantt__bar_drag' : ''
                        }${m.status ? ` mv-gantt__bar_${m.status}` : ''}`}
                        style={{...barColor(m), left, width: w}}
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
    };

    const renderEpic = (epic?: Epic) => {
        const group = epic ? items.filter((m) => m.epicId === epic.id) : ungrouped;
        const id = epic?.id ?? '';
        const isCollapsed = collapsed.has(id);
        const name = epic?.title || 'Без эпика';
        return (
            <EpicDropRow epicId={epic?.id ?? null} disabled={!canDrag}>
                <div className="mv-gantt__label mv-gantt__label_epic">
                    <button
                        type="button"
                        className="mv-gantt__collapse"
                        onClick={() => toggleGroup(id)}
                        aria-expanded={!isCollapsed}
                        aria-label={`${isCollapsed ? 'Развернуть' : 'Свернуть'} эпик «${name}»`}
                        title={isCollapsed ? 'Развернуть вехи' : 'Свернуть вехи'}
                        data-collapse-epic={id}
                    >
                        <Icon data={isCollapsed ? ChevronRight : ChevronDown} size={16} />
                    </button>
                    <button
                        type="button"
                        className="mv-gantt__epic-open"
                        onClick={() => epic && onOpenEpic?.(epic.id)}
                        disabled={!epic || !onOpenEpic}
                        title={epic ? name : 'Вехи без эпика'}
                    >
                        <span className="mv-gantt__epic-name">
                            <Icon data={Layers} size={14} />
                            {name}
                        </span>
                        <span className="mv-gantt__meta">{milestonesWord(group.length)}</span>
                    </button>
                </div>
                <div className="mv-gantt__track" style={{width}}>
                    {isCollapsed &&
                        group.map((m) => {
                            const a = Math.min(Math.max(toDay(m.start), rs), re);
                            const b = Math.max(Math.min(toDay(m.end), re), a);
                            return (
                                <span
                                    key={m.id}
                                    className={`mv-gantt__epic-bar${m.status ? ` mv-gantt__bar_${m.status}` : ''}`}
                                    style={{...barColor(m), left: x(a), width: Math.max(3, (b - a + 1) * px)}}
                                    aria-hidden="true"
                                />
                            );
                        })}
                </div>
            </EpicDropRow>
        );
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={({active}) => setActiveId(String(active.id))}
            onDragEnd={finishMove}
            onDragCancel={() => setActiveId(null)}
            accessibility={{
                screenReaderInstructions: {
                    draggable:
                        'Пробел, чтобы взять веху, стрелки, чтобы выбрать эпик, пробел, чтобы отпустить. Escape отменяет перенос.',
                },
            }}
        >
            <div className="mv-gantt-shell">
                <div className="mv-gantt__toolbar">
                    <div>
                        {epics.length > 0 && (
                            <Button view="flat-secondary" size="s" onClick={toggleAll}>
                                {allCollapsed ? 'Развернуть все' : 'Свернуть все'}
                            </Button>
                        )}
                    </div>
                    <div className="mv-gantt__zoom">
                        <Icon data={MagnifierMinus} size={15} />
                        <Slider
                            className="mv-gantt__zoom-slider"
                            min={MIN_ZOOM}
                            max={MAX_ZOOM}
                            step={10}
                            value={zoom}
                            onUpdate={changeZoom}
                            tooltipDisplay="auto"
                            tooltipFormat={(value) => `${value}%`}
                            aria-label="Масштаб дорожной карты"
                        />
                        <Icon data={MagnifierPlus} size={16} />
                        <button
                            type="button"
                            className="mv-gantt__zoom-value"
                            onClick={() => changeZoom(100)}
                            disabled={zoom === 100}
                            title="Вернуть масштаб 100%"
                            aria-label={`Масштаб ${zoom}%. Нажмите, чтобы вернуть 100%`}
                        >
                            {zoom}%
                        </button>
                    </div>
                </div>
                <div className="mv-gantt" ref={scroller}>
                    <div className="mv-gantt__inner" style={{width: `calc(var(--mv-gantt-label) + ${width}px)`}}>
                <div className="mv-gantt__head">
                    <div className="mv-gantt__label mv-gantt__label_head">
                        <Text variant="caption-2" color="secondary">
                            {epics.length ? 'Эпики и вехи' : 'Вехи'}
                        </Text>
                        {hasToday && width > room + 1 && (
                            <Button view="flat-secondary" size="xs" className="mv-gantt__to-today" onClick={toToday}>
                                К сегодня
                            </Button>
                        )}
                    </div>
                    <div className={`mv-gantt__scale${deadlines.length ? ' mv-gantt__scale_deadlines' : ''}`} style={{width}}>
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
                        {deadlines.length > 0 && (
                            <div className="mv-gantt__deadlines">
                                {deadlines.map((d) => {
                                    const day = Math.min(Math.max(toDay(d.date), rs), re);
                                    const left = x(day) + px / 2;
                                    const align = left < 90 ? 'start' : width - left < 90 ? 'end' : 'center';
                                    const date = datesText({start: d.date, end: d.date});
                                    return (
                                        <button
                                            key={d.id}
                                            type="button"
                                            className={`mv-gantt__deadline-label mv-gantt__deadline-label_${align}`}
                                            style={{left}}
                                            onClick={() => onOpenDeadline?.(d.id)}
                                            disabled={!onOpenDeadline}
                                            title={`${d.title || 'Дедлайн'} · ${date}`}
                                        >
                                            <Icon data={Flag} size={11} />
                                            <span>{d.title || 'Дедлайн'}</span>
                                            <span className="mv-gantt__deadline-date">{date}</span>
                                        </button>
                                    );
                                })}
                            </div>
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
                        {deadlines.map((d) => {
                            const day = Math.min(Math.max(toDay(d.date), rs), re);
                            return <span key={d.id} className="mv-gantt__deadline-line" style={{left: x(day) + px / 2}} />;
                        })}
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
                                {readOnly ? 'Вех пока нет.' : 'Вех пока нет. Добавьте первую кнопкой «Добавить веху» ниже.'}
                            </Text>
                        </div>
                    )}

                    {epics.length > 0 ? (
                        <>
                            {epics.map((epic) => (
                                <React.Fragment key={epic.id}>
                                    {renderEpic(epic)}
                                    {!collapsed.has(epic.id) &&
                                        items.filter((m) => m.epicId === epic.id).map(renderMilestone)}
                                </React.Fragment>
                            ))}
                            {renderEpic()}
                            {!collapsed.has('') && ungrouped.map(renderMilestone)}
                        </>
                    ) : (
                        items.map(renderMilestone)
                    )}

                    {!readOnly && (onAdd || onAddEpic || onAddDeadline) && (
                        <div className="mv-gantt__row mv-gantt__row_add">
                            <div className="mv-gantt__label mv-gantt__label_add">
                                {onAdd && <AddListItem onClick={onAdd}>Добавить веху</AddListItem>}
                                {onAddEpic && <AddListItem onClick={onAddEpic}>Добавить эпик</AddListItem>}
                                {onAddDeadline && <AddListItem onClick={onAddDeadline}>Добавить дедлайн</AddListItem>}
                            </div>
                        </div>
                    )}
                </div>
                    </div>
                </div>
            </div>
            <div
                ref={contextAnchor}
                className="mv-gantt__context-anchor"
                style={{left: contextMenu?.x ?? 0, top: contextMenu?.y ?? 0}}
                aria-hidden="true"
            />
            <Popup
                open={Boolean(contextMilestone)}
                anchorRef={contextAnchor}
                strategy="fixed"
                placement="bottom-start"
                offset={4}
                initialFocus={-1}
                returnFocus={false}
                onOpenChange={(open) => {
                    if (!open) closeContextMenu();
                }}
                role="dialog"
                aria-label={contextMilestone ? `Действия с вехой «${contextMilestone.title}»` : 'Действия с вехой'}
            >
                {contextMilestone &&
                    (renaming ? (
                        <div className="mv-gantt__context-rename" onContextMenu={(e) => e.preventDefault()}>
                            <TextInput
                                size="m"
                                autoFocus
                                value={contextTitle}
                                onUpdate={setContextTitle}
                                onFocus={(e) => e.target.select()}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        renameMilestone();
                                    } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setRenaming(false);
                                        setContextTitle(contextMilestone.title);
                                    }
                                }}
                                placeholder="Название вехи"
                                aria-label="Новое название вехи"
                            />
                            <div className="mv-gantt__context-rename-actions">
                                <Button view="action" size="s" onClick={renameMilestone} disabled={!contextTitle.trim()}>
                                    Сохранить
                                </Button>
                                <Button
                                    view="flat"
                                    size="s"
                                    onClick={() => {
                                        setRenaming(false);
                                        setContextTitle(contextMilestone.title);
                                    }}
                                >
                                    Отмена
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Menu size="m" className="mv-gantt__context-menu">
                            {onRename && (
                                <Menu.Item iconStart={<Icon data={Pencil} size={16} />} onClick={() => setRenaming(true)}>
                                    Переименовать
                                </Menu.Item>
                            )}
                            {onDuplicate && (
                                <Menu.Item
                                    iconStart={<Icon data={CopyPlus} size={16} />}
                                    onClick={() => {
                                        closeContextMenu();
                                        onDuplicate(contextMilestone);
                                    }}
                                >
                                    Дублировать веху
                                </Menu.Item>
                            )}
                        </Menu>
                    ))}
            </Popup>
            <DragOverlay>
                {activeMilestone && (
                    <div className="mv-gantt__drag-overlay">
                        <Icon data={Grip} size={15} />
                        <span>{activeMilestone.title || 'Без названия'}</span>
                    </div>
                )}
            </DragOverlay>
        </DndContext>
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
    const end = new Date(y, d.getMonth() + (scale === 'weeks' ? 2 : 11), 1);
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
                            <SegmentedRadioGroup.Option value="weeks">Недели</SegmentedRadioGroup.Option>
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
    tags: Tag[];
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
                    const r: Roadmap = {
                        id: uid(),
                        ...s,
                        milestones: [],
                        epics: [],
                        deadlines: [],
                        createdAt: new Date().toISOString(),
                    };
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
                        style={{...barColor(m), left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, top: 12 + i * 7}}
                    />
                );
            })}
            <span className="mv-map-card__strip-axis" />
            {(map.deadlines ?? []).map((d) => (
                <span key={d.id} className="mv-map-card__strip-deadline" style={{left: pct(toDay(d.date) + 0.5)}} />
            ))}
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
    const [epicId, setEpicId] = React.useState<string | null>(null);
    const [deadlineId, setDeadlineId] = React.useState<string | null>(null);
    const milestone = map.milestones.find((m) => m.id === p.milestoneId);
    const epic = (map.epics ?? []).find((e) => e.id === epicId);
    const deadline = (map.deadlines ?? []).find((d) => d.id === deadlineId);

    // правки накладываем на самую свежую версию карты: текст сохраняется с задержкой
    const mapRef = React.useRef(map);
    mapRef.current = map;
    const saveMap = (patch: Partial<Roadmap>) => p.onSave({...mapRef.current, ...patch});
    const auto = useAutosave<Roadmap>(saveMap);
    const patchMilestone = (id: string, patch: Partial<Milestone>) =>
        saveMap({milestones: mapRef.current.milestones.map((x) => (x.id === id ? {...x, ...patch} : x))});
    const patchEpic = (id: string, patch: Partial<Epic>) =>
        saveMap({epics: (mapRef.current.epics ?? []).map((x) => (x.id === id ? {...x, ...patch} : x))});
    const patchDeadline = (id: string, patch: Partial<Deadline>) =>
        saveMap({deadlines: (mapRef.current.deadlines ?? []).map((x) => (x.id === id ? {...x, ...patch} : x))});
    const addMilestone = () => {
        const rs = monthStart(map.from);
        const re = monthEnd(map.to);
        const len = map.scale === 'weeks' ? 6 : map.scale === 'months' ? 29 : 89;
        const start = Math.max(rs, Math.min(toDay(dayKey()), re - len));
        const m: Milestone = {id: uid(), title: 'Новая веха', start: fromDay(start), end: fromDay(Math.min(re, start + len))};
        p.onSave({...map, milestones: [...map.milestones, m]});
        p.onOpenMilestone(m.id);
    };
    const duplicateMilestone = (m: Milestone) => {
        const current = mapRef.current;
        const index = current.milestones.findIndex((x) => x.id === m.id);
        const source = index >= 0 ? current.milestones[index]! : m;
        const copy: Milestone = {
            ...source,
            id: uid(),
            title: `${source.title || 'Без названия'} — копия`,
            blockedBy: undefined,
        };
        const milestones = [...current.milestones];
        milestones.splice(index >= 0 ? index + 1 : milestones.length, 0, copy);
        p.onSave({...current, milestones});
        p.onOpenMilestone(copy.id);
    };
    const moveMilestone = (id: string, epicId: string | null) => {
        const milestone = mapRef.current.milestones.find((m) => m.id === id);
        if (!milestone || (milestone.epicId ?? null) === epicId) return;
        const previous = milestone.epicId ?? null;
        auto.save({
            milestones: mapRef.current.milestones.map((m) => (m.id === id ? {...m, epicId} : m)),
        });
        const target = (mapRef.current.epics ?? []).find((e) => e.id === epicId)?.title || 'Без эпика';
        p.undoable(`Веха «${milestone.title}» перенесена в «${target}»`, () =>
            auto.save({
                milestones: mapRef.current.milestones.map((m) => (m.id === id ? {...m, epicId: previous} : m)),
            }),
        );
    };
    const removeMilestone = (m: Milestone) => {
        p.onOpenMilestone(null);
        p.onSave({...map, milestones: map.milestones.filter((x) => x.id !== m.id)});
        p.undoable(`Веха «${m.title}» удалена`, () => p.onSave({...map}));
    };
    const addEpic = () => {
        const item: Epic = {id: uid(), title: 'Новый эпик'};
        p.onSave({...map, epics: [...(map.epics ?? []), item]});
        setEpicId(item.id);
    };
    const removeEpic = (item: Epic) => {
        setEpicId(null);
        p.onSave({
            ...map,
            epics: (map.epics ?? []).filter((x) => x.id !== item.id),
            milestones: map.milestones.map((m) => (m.epicId === item.id ? {...m, epicId: null} : m)),
        });
        p.undoable(`Эпик «${item.title}» удалён`, () => p.onSave({...map}));
    };
    const addDeadline = () => {
        const rs = monthStart(map.from);
        const re = monthEnd(map.to);
        const item: Deadline = {id: uid(), title: 'Новый дедлайн', date: fromDay(Math.min(Math.max(toDay(dayKey()), rs), re))};
        p.onSave({...map, deadlines: [...(map.deadlines ?? []), item]});
        setDeadlineId(item.id);
    };
    const removeDeadline = (item: Deadline) => {
        setDeadlineId(null);
        p.onSave({...map, deadlines: (map.deadlines ?? []).filter((x) => x.id !== item.id)});
        p.undoable(`Дедлайн «${item.title}» удалён`, () => p.onSave({...map}));
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
                Тяните полосу или её край, чтобы изменить сроки. За значок <span aria-hidden="true">⋮⋮</span> веху можно
                перенести в другой эпик.
            </Text>

            <Gantt
                roadmap={map}
                onChange={(m) =>
                    auto.save({milestones: mapRef.current.milestones.map((x) => (x.id === m.id ? m : x))})
                }
                onMoveToEpic={p.disabled ? undefined : moveMilestone}
                onOpen={(id) => p.onOpenMilestone(id)}
                onRename={p.disabled ? undefined : (id, value) => patchMilestone(id, {title: value})}
                onDuplicate={p.disabled ? undefined : duplicateMilestone}
                onAdd={p.disabled ? undefined : addMilestone}
                onOpenEpic={setEpicId}
                onAddEpic={p.disabled ? undefined : addEpic}
                onOpenDeadline={setDeadlineId}
                onAddDeadline={p.disabled ? undefined : addDeadline}
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
                        epics={map.epics ?? []}
                        scale={map}
                        tasks={linked(milestone.id)}
                        tags={p.tags}
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

            <Dialog open={Boolean(epic)} onClose={() => setEpicId(null)} hasCloseButton={false} size="s" aria-label="Эпик">
                {epic && (
                    <EpicDetails
                        key={epic.id}
                        epic={epic}
                        count={map.milestones.filter((m) => m.epicId === epic.id).length}
                        onSave={(patch) => patchEpic(epic.id, patch)}
                        onDelete={() => removeEpic(epic)}
                        onClose={() => setEpicId(null)}
                    />
                )}
            </Dialog>

            <Dialog
                open={Boolean(deadline)}
                onClose={() => setDeadlineId(null)}
                hasCloseButton={false}
                size="s"
                aria-label="Дедлайн"
            >
                {deadline && (
                    <DeadlineDetails
                        key={deadline.id}
                        deadline={deadline}
                        scale={map}
                        onSave={(patch) => patchDeadline(deadline.id, patch)}
                        onDelete={() => removeDeadline(deadline)}
                        onClose={() => setDeadlineId(null)}
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
                                    По ссылке карту увидит любой, даже без аккаунта: описание, эпики, вехи, дедлайны,
                                    ответственных и блокировки, но без задач. Менять ничего нельзя.
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
                                    Включите ссылку, чтобы показать карту тем, у кого нет аккаунта. Они увидят описание, эпики,
                                    вехи, дедлайны, ответственных и блокировки, но не задачи. Ссылку можно выключить в любой
                                    момент.
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

function EpicDetails({
    epic,
    count,
    onSave,
    onDelete,
    onClose,
}: {
    epic: Epic;
    count: number;
    onSave: (p: Partial<Epic>) => Promise<void> | null;
    onDelete: () => void;
    onClose: () => void;
}) {
    const [title, setTitle] = React.useState(epic.title);
    const auto = useAutosave<Epic>(onSave);
    const close = () => {
        auto.flush();
        onClose();
    };
    return (
        <div className="mv-details mv-details_popup">
            <div className="mv-details__head">
                <Label theme="utility" size="s" icon={<Icon data={Layers} size={12} />}>
                    Эпик
                </Label>
                <SaveStatus state={auto.state} idle={milestonesWord(count)} />
                <div className="mv-details__actions">
                    <ActionTooltip title="Удалить эпик">
                        <Button view="flat-danger" size="m" onClick={onDelete} aria-label="Удалить эпик">
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
                    if (!title.trim()) setTitle(epic.title);
                    auto.flush();
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                placeholder="Название эпика"
                aria-label="Название эпика"
            />
            <Text color="secondary">
                Эпик объединяет вехи в отдельную группу на дорожной карте. При удалении эпика его вехи останутся в группе
                «Без эпика».
            </Text>
        </div>
    );
}

function DeadlineDetails({
    deadline,
    scale,
    onSave,
    onDelete,
    onClose,
}: {
    deadline: Deadline;
    scale: Pick<Roadmap, 'from' | 'to'>;
    onSave: (p: Partial<Deadline>) => Promise<void> | null;
    onDelete: () => void;
    onClose: () => void;
}) {
    const [title, setTitle] = React.useState(deadline.title);
    const auto = useAutosave<Deadline>(onSave);
    const close = () => {
        auto.flush();
        onClose();
    };
    return (
        <div className="mv-details mv-details_popup">
            <div className="mv-details__head">
                <Label theme="danger" size="s" icon={<Icon data={Flag} size={12} />}>
                    Дедлайн
                </Label>
                <SaveStatus state={auto.state} idle={datesText({start: deadline.date, end: deadline.date})} />
                <div className="mv-details__actions">
                    <ActionTooltip title="Удалить дедлайн">
                        <Button view="flat-danger" size="m" onClick={onDelete} aria-label="Удалить дедлайн">
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
                    if (!title.trim()) setTitle(deadline.title);
                    auto.flush();
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                placeholder="Что должно быть готово"
                aria-label="Название дедлайна"
            />
            <section className="mv-field">
                <Text variant="subheader-1">Дата</Text>
                <div className="mv-date-field">
                    <Text variant="caption-2" color="secondary">
                        Контрольный день
                    </Text>
                    <DateField
                        value={deadline.date}
                        min={fromDay(monthStart(scale.from))}
                        max={fromDay(monthEnd(scale.to))}
                        onChange={(day) => auto.save({date: day})}
                        ariaLabel="Дата дедлайна"
                    />
                </div>
            </section>
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

const RECENT_COLORS_KEY = 'muravey:roadmap-recent-colors';
const RECENT_COLORS_LIMIT = 7;
const DEFAULT_COLORS = [
    {value: '#3697f1', name: 'Синий'},
    {value: '#30aa6e', name: 'Зелёный'},
    {value: '#eaa000', name: 'Жёлтый'},
    {value: '#e05d4f', name: 'Красный'},
    {value: '#8c5ac7', name: 'Фиолетовый'},
    {value: '#d9579b', name: 'Розовый'},
    {value: '#718096', name: 'Серый'},
];

function loadRecentColors() {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) ?? '[]');
        if (Array.isArray(stored)) {
            const colors = stored
                .filter((c): c is string => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c))
                .map((c) => c.toLowerCase());
            const recent = [...new Set(colors)].slice(0, RECENT_COLORS_LIMIT);
            if (recent.length > 0) return recent;
        }
    } catch {
        /* используем начальную палитру */
    }
    return DEFAULT_COLORS.map((c) => c.value);
}

const recentColorName = (value: string) =>
    DEFAULT_COLORS.find((c) => c.value === value)?.name ?? `Цвет ${value.toUpperCase()}`;

const shareUrl = (id: string) => `${window.location.origin}/?roadmap=${id}`;

function MilestoneDetails({
    milestone,
    all,
    epics,
    scale,
    tasks,
    tags,
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
    epics: Epic[];
    scale: Pick<Roadmap, 'from' | 'to'>;
    tasks: Task[];
    tags: Tag[];
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
    const [recentColors, setRecentColors] = React.useState(loadRecentColors);
    const auto = useAutosave<Milestone>(onSave);
    React.useEffect(() => {
        try {
            localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recentColors));
        } catch {
            /* история цветов просто не сохранится между открытиями */
        }
    }, [recentColors]);
    const chooseColor = (value: string) => {
        const color = value.toLowerCase();
        auto.save({color});
        setRecentColors((current) => [color, ...current.filter((c) => c !== color)].slice(0, RECENT_COLORS_LIMIT));
    };
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
                    <div className="mv-date-field">
                        <Text variant="caption-2" color="secondary">
                            Начало
                        </Text>
                        <DateField
                            value={milestone.start}
                            min={fromDay(lo)}
                            max={fromDay(re)}
                            onChange={(day) => setDate('start', day)}
                            ariaLabel="Дата начала вехи"
                        />
                    </div>
                    <div className="mv-date-field">
                        <Text variant="caption-2" color="secondary">
                            Конец
                        </Text>
                        <DateField
                            value={milestone.end}
                            min={fromDay(rs)}
                            max={fromDay(hi)}
                            onChange={(day) => setDate('end', day)}
                            ariaLabel="Дата окончания вехи"
                        />
                    </div>
                </div>
            </section>

            {epics.length > 0 && (
                <section className="mv-field">
                    <Text variant="subheader-1">Эпик</Text>
                    <Select
                        width="max"
                        value={[milestone.epicId ?? '']}
                        onUpdate={([v]) => auto.save({epicId: v || null})}
                        options={[
                            {value: '', content: 'Без эпика'},
                            ...epics.map((e) => ({value: e.id, content: e.title})),
                        ]}
                        aria-label="Эпик"
                    />
                </section>
            )}

            <section className="mv-field">
                <Text variant="subheader-1">Цвет полосы</Text>
                <div className="mv-color-picker">
                    <Button
                        size="s"
                        view={milestone.color ? 'outlined' : 'action'}
                        onClick={() => auto.save({color: undefined})}
                    >
                        Авто
                    </Button>
                    {recentColors.map((color) => {
                        const selected = milestone.color?.toLowerCase() === color;
                        const name = recentColorName(color);
                        return (
                            <button
                                key={color}
                                type="button"
                                className={`mv-color-picker__swatch${selected ? ' mv-color-picker__swatch_on' : ''}`}
                                style={{background: color}}
                                onClick={() => chooseColor(color)}
                                aria-label={name}
                                aria-pressed={selected}
                                title={name}
                            />
                        );
                    })}
                    <label className="mv-color-picker__custom" title="Выбрать другой цвет">
                        <input
                            type="color"
                            value={milestone.color ?? recentColors[0] ?? '#3697f1'}
                            onChange={(e) => chooseColor(e.target.value)}
                            aria-label="Свой цвет полосы"
                        />
                        <span>Свой цвет</span>
                    </label>
                </div>
                <Text variant="caption-2" color="secondary">
                    Показаны последние использованные цвета. «Авто» меняет цвет по статусу вехи.
                </Text>
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
                        <TaskPicker
                            label="Привязать задачу"
                            icon={Plus}
                            tasks={linkable}
                            tags={tags}
                            onPick={(id) => onLinkTask(id, milestone.id)}
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
function MilestoneView({
    milestone,
    all,
    epics,
    onOpen,
}: {
    milestone: Milestone;
    all: Milestone[];
    epics: Epic[];
    onOpen: (id: string) => void;
}) {
    const blockers = blockersOf(milestone, all);
    const blocks = dependentsOf(milestone, all);
    const epic = epics.find((e) => e.id === milestone.epicId);
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
            {epic && (
                <section className="mv-field">
                    <Text variant="subheader-1">Эпик</Text>
                    <Text>{epic.title}</Text>
                </section>
            )}
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

function DeadlineView({deadline}: {deadline: Deadline}) {
    return (
        <div className="mv-details mv-details_popup">
            <div className="mv-details__head">
                <Label theme="danger" size="s" icon={<Icon data={Flag} size={12} />}>
                    Дедлайн
                </Label>
            </div>
            <Text variant="header-1" as="h2" className="mv-ms-title">
                {deadline.title}
            </Text>
            <section className="mv-field">
                <Text variant="subheader-1">Дата</Text>
                <Text>{datesText({start: deadline.date, end: deadline.date})}</Text>
            </section>
        </div>
    );
}

export function SharedRoadmap({id}: {id: string}) {
    const [openId, setOpenId] = React.useState<string | null>(null);
    const [deadlineId, setDeadlineId] = React.useState<string | null>(null);
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
                            onOpenDeadline={setDeadlineId}
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
                const ready = state.kind === 'ready' && state.map ? state.map : null;
                const all = ready?.milestones ?? [];
                const m = all.find((x) => x.id === openId);
                const deadline = ready?.deadlines?.find((d) => d.id === deadlineId);
                return (
                    <>
                        <Dialog open={Boolean(m)} onClose={() => setOpenId(null)} size="m" aria-label="Веха">
                            {m && (
                                <MilestoneView
                                    key={m.id}
                                    milestone={m}
                                    all={all}
                                    epics={ready?.epics ?? []}
                                    onOpen={setOpenId}
                                />
                            )}
                        </Dialog>
                        <Dialog
                            open={Boolean(deadline)}
                            onClose={() => setDeadlineId(null)}
                            size="s"
                            aria-label="Дедлайн"
                        >
                            {deadline && <DeadlineView deadline={deadline} />}
                        </Dialog>
                    </>
                );
            })()}
        </div>
    );
}
