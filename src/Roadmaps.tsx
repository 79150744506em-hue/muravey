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
    TextInput,
} from '@gravity-ui/uikit';
import {ArrowLeft, Flag, Gear, Globe, LinkSlash, Plus, TrashBin, Xmark} from '@gravity-ui/icons';

import type {Milestone, Roadmap, RoadmapScale, Task} from './types';
import {dayKey, uid} from './types';
import {loadSharedRoadmap} from './store';
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
const fmtDayYear = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});

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

export function Gantt({
    roadmap,
    readOnly = false,
    onChange,
    onOpen,
    meta,
}: {
    roadmap: GanttMap;
    readOnly?: boolean;
    onChange?: (m: Milestone) => void;
    onOpen?: (id: string) => void;
    /** подпись под названием вехи, например сколько задач закрыто */
    meta?: (m: Milestone) => React.ReactNode;
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
        moved: boolean;
    } | null>(null);

    // сразу показываем сегодняшний день, если он на карте
    React.useEffect(() => {
        const el = scroller.current;
        if (el && today >= rs && today <= re) el.scrollLeft = Math.max(0, x(today) - 120);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roadmap.from, roadmap.to, roadmap.scale]);

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
        drag.current = {id: m.id, mode, x0: e.clientX, start: toDay(m.start), end: toDay(m.end), moved: false};
    };
    const move = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x0;
        if (Math.abs(dx) > 3) d.moved = true;
        if (!d.moved) return;
        const days = Math.round(dx / px);
        let {start, end} = d;
        if (d.mode === 'move') {
            const len = end - start;
            start = Math.min(Math.max(rs, start + days), re - len);
            end = start + len;
        } else if (d.mode === 'start') {
            start = Math.min(Math.max(rs, start + days), end);
        } else {
            end = Math.max(Math.min(re, end + days), start);
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
                    </div>
                    <div className="mv-gantt__scale" style={{width}}>
                        <div className="mv-gantt__years">
                            {years.map((y) => (
                                <span key={y.key} className="mv-gantt__year" style={{left: y.left, width: y.w}}>
                                    {y.label}
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
                        {today >= rs && today <= re && (
                            <span className="mv-gantt__today" style={{left: x(today) + px / 2}} title="Сегодня" />
                        )}
                    </div>

                    {items.length === 0 && (
                        <div className="mv-gantt__empty">
                            <Text color="secondary">
                                {readOnly ? 'Вех пока нет.' : 'Вех пока нет. Добавьте первую кнопкой «Новая веха».'}
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
                        return (
                            <div key={m.id} className="mv-gantt__row">
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
                                        }`}
                                        style={{left, width: w}}
                                        title={`${m.title}: ${dates}`}
                                        onPointerDown={(ev) => down(ev, m, 'move')}
                                        onPointerMove={move}
                                        onPointerUp={() => up(m)}
                                        onPointerCancel={() => {
                                            drag.current = null;
                                            setPreview(null);
                                        }}
                                        onClick={readOnly && onOpen ? () => onOpen(m.id) : undefined}
                                    >
                                        {!readOnly && (
                                            <span
                                                className="mv-gantt__handle mv-gantt__handle_start"
                                                onPointerDown={(ev) => down(ev, m, 'start')}
                                                onPointerMove={move}
                                                onPointerUp={() => up(m)}
                                                aria-hidden="true"
                                            />
                                        )}
                                        <span className="mv-gantt__dates">{dates}</span>
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
                                </div>
                            </div>
                        );
                    })}
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
    onSave: (r: Roadmap) => void;
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
            <Button view="action" size="l" onClick={() => setCreating(true)} disabled={p.disabled} className="mv-map-new">
                <Icon data={Plus} size={16} />
                Новая дорожная карта
            </Button>
            {sorted.length === 0 ? (
                <div className="mv-empty">
                    <Text color="secondary">Дорожных карт пока нет.</Text>
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
                            </button>
                        </li>
                    ))}
                </ul>
            )}
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

function milestonesWord(n: number) {
    const a = n % 10;
    const b = n % 100;
    const w = a === 1 && b !== 11 ? 'веха' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'вехи' : 'вех';
    return `${n} ${w}`;
}

function RoadmapPage({map, ...p}: RoadmapsProps & {map: Roadmap}) {
    const [title, setTitle] = React.useState(map.title);
    React.useEffect(() => setTitle(map.title), [map.title]);
    const [settings, setSettings] = React.useState(false);
    const [sharing, setSharing] = React.useState(false);
    const milestone = map.milestones.find((m) => m.id === p.milestoneId);

    const saveMilestone = (m: Milestone) => p.onSave({...map, milestones: map.milestones.map((x) => (x.id === m.id ? m : x))});
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
                    <Button view="action" size="m" onClick={addMilestone} disabled={p.disabled}>
                        <Icon data={Plus} size={16} />
                        Новая веха
                    </Button>
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
            <TextInput
                view="clear"
                size="xl"
                className="mv-map__title"
                value={title}
                onUpdate={setTitle}
                onBlur={() => {
                    const t = title.trim();
                    if (!t) setTitle(map.title);
                    else if (t !== map.title) p.onSave({...map, title: t});
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                aria-label="Название дорожной карты"
            />
            <Text variant="body-1" color="secondary">
                {SCALE_NAMES[map.scale]} · {periodText(map)}. Тяните полосу, чтобы сдвинуть веху, или её край, чтобы изменить срок.
            </Text>

            <Gantt
                roadmap={map}
                onChange={saveMilestone}
                onOpen={(id) => p.onOpenMilestone(id)}
                meta={(m) => {
                    const ts = linked(m.id);
                    return ts.length ? `задач закрыто: ${ts.filter((t) => t.done).length} из ${ts.length}` : null;
                }}
            />

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
                        scale={map}
                        tasks={linked(milestone.id)}
                        linkable={p.tasks.filter((t) => !t.done && t.milestoneId !== milestone.id)}
                        onSave={saveMilestone}
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
                    p.onSave({...map, ...s});
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
                                    По ссылке карту увидит любой, даже без аккаунта: только вехи и сроки, без задач. Менять
                                    ничего нельзя.
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
                                    Включите ссылку, чтобы показать карту тем, у кого нет аккаунта. Они увидят только вехи и
                                    сроки. Ссылку можно выключить в любой момент.
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

const shareUrl = (id: string) => `${window.location.origin}/?roadmap=${id}`;

function MilestoneDetails({
    milestone,
    scale,
    tasks,
    linkable,
    onSave,
    onDelete,
    onClose,
    onOpenTask,
    onLinkTask,
    onToggleTask,
}: {
    milestone: Milestone;
    scale: Pick<Roadmap, 'from' | 'to'>;
    tasks: Task[];
    linkable: Task[];
    onSave: (m: Milestone) => void;
    onDelete: () => void;
    onClose: () => void;
    onOpenTask: (id: string) => void;
    onLinkTask: (taskId: string, milestoneId: string | null) => void;
    onToggleTask: (t: Task) => void;
}) {
    const [title, setTitle] = React.useState(milestone.title);
    const saveTitle = () => {
        const t = title.trim();
        if (!t) setTitle(milestone.title);
        else if (t !== milestone.title) onSave({...milestone, title: t});
    };
    const min = fromDay(monthStart(scale.from));
    const max = fromDay(monthEnd(scale.to));
    const setDate = (k: 'start' | 'end', v: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
        const next = {...milestone, [k]: v};
        // начало не позже конца: двигаем второй край следом
        if (next.start > next.end) {
            if (k === 'start') next.end = v;
            else next.start = v;
        }
        onSave(next);
    };
    const open = tasks.filter((t) => !t.done).length;

    return (
        <div className="mv-details mv-details_popup">
            <div className="mv-details__head">
                <Label theme="info" size="s" icon={<Icon data={Flag} size={12} />}>
                    Веха
                </Label>
                <div className="mv-details__actions">
                    <ActionTooltip title="Удалить веху">
                        <Button view="flat-danger" size="m" onClick={onDelete} aria-label="Удалить веху">
                            <Icon data={TrashBin} size={16} />
                        </Button>
                    </ActionTooltip>
                </div>
                <Button
                    view="flat"
                    size="m"
                    onClick={() => {
                        saveTitle();
                        onClose();
                    }}
                    aria-label="Закрыть"
                    className="mv-details__close"
                >
                    <Icon data={Xmark} size={16} />
                </Button>
            </div>

            <TextInput
                view="clear"
                size="xl"
                className="mv-map__title"
                value={title}
                onUpdate={setTitle}
                onBlur={saveTitle}
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
                        <input type="date" value={milestone.start} min={min} max={max} onChange={(e) => setDate('start', e.target.value)} />
                    </label>
                    <label className="mv-date-field">
                        <Text variant="caption-2" color="secondary">
                            Конец
                        </Text>
                        <input type="date" value={milestone.end} min={min} max={max} onChange={(e) => setDate('end', e.target.value)} />
                    </label>
                </div>
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

export function SharedRoadmap({id}: {id: string}) {
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
                    <Gantt roadmap={state.map} readOnly />
                )}
            </main>
            <Text variant="caption-2" color="secondary" className="mv-footnote">
                Только просмотр. Сделано в Муравье.
            </Text>
        </div>
    );
}
