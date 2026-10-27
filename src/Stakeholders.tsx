import React from 'react';
import {
    ActionTooltip,
    Button,
    Checkbox,
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
import {ArrowLeft, Calendar, LinkSlash, Pencil, Persons, Plus, TrashBin, Xmark} from '@gravity-ui/icons';

import type {Attitude, ContactKind, Interaction, Outcome, Stakeholder, StakeholderMap, Task} from './types';
import {addDays, dayKey, openTasksOf, uid} from './types';
import {DescriptionEditor} from './DescriptionEditor';
import {SaveStatus, useAutosave} from './SaveStatus';
import logo from './assets/logo.png';

/* ---------- справочники ---------- */

export const ATTITUDES: Record<Attitude, string> = {ally: 'Союзник', neutral: 'Нейтрален', skeptic: 'Скептик'};
export const KINDS: Record<ContactKind, {name: string; mark: string}> = {
    meeting: {name: 'Встреча', mark: '🤝'},
    call: {name: 'Звонок', mark: '📞'},
    message: {name: 'Письмо', mark: '✉️'},
    demo: {name: 'Демо', mark: '🖥'},
    other: {name: 'Другое', mark: '💬'},
};
const OUTCOMES: Record<Outcome, {name: string; mark: string}> = {
    good: {name: 'Хорошо', mark: '👍'},
    neutral: {name: 'Нормально', mark: '😐'},
    bad: {name: 'Плохо', mark: '👎'},
};

type Zone = 'manage' | 'satisfy' | 'inform' | 'monitor';
/** зоны матрицы «влияние × интерес» и как часто стоит выходить на связь, дней */
const ZONES: Record<Zone, {name: string; hint: string; every: number}> = {
    manage: {name: 'Управлять плотно', hint: 'Высокое влияние, высокий интерес', every: 7},
    satisfy: {name: 'Держать удовлетворёнными', hint: 'Высокое влияние, низкий интерес', every: 14},
    inform: {name: 'Держать в курсе', hint: 'Низкое влияние, высокий интерес', every: 14},
    monitor: {name: 'Наблюдать', hint: 'Низкое влияние, низкий интерес', every: 30},
};
export const zoneOf = (s: Pick<Stakeholder, 'interest' | 'influence'>): Zone =>
    s.influence >= 0.5 ? (s.interest >= 0.5 ? 'manage' : 'satisfy') : s.interest >= 0.5 ? 'inform' : 'monitor';
export const zoneName = (s: Pick<Stakeholder, 'interest' | 'influence'>) => ZONES[zoneOf(s)].name;

const fmtShort = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short'});
const fmtLong = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'});
const asDate = (day: string) => new Date(day + 'T12:00:00');

/** «сегодня», «завтра», «5 нояб.» — для меток с датой задачи */
export function dayText(day: string, today = dayKey()) {
    if (day === today) return 'сегодня';
    if (day === addDays(today, 1)) return 'завтра';
    if (day === addDays(today, -1)) return 'вчера';
    return fmtShort.format(asDate(day));
}

const initials = (name: string) =>
    name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('') || '?';

const lastContact = (s: Stakeholder) => s.history.reduce<string | null>((a, h) => (!a || h.date > a ? h.date : a), null);

function agoText(day: string, today: string) {
    const n = Math.round((asDate(today).getTime() - asDate(day).getTime()) / 864e5);
    if (n <= 0) return 'сегодня';
    if (n === 1) return 'вчера';
    return `${n} ${plural(n, 'день', 'дня', 'дней')} назад`;
}

function plural(n: number, one: string, few: string, many: string) {
    const a = n % 10;
    const b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
}
const peopleWord = (n: number) => `${n} ${plural(n, 'стейкхолдер', 'стейкхолдера', 'стейкхолдеров')}`;

/** Найти стейкхолдера по id во всех картах. */
export function findPerson(maps: StakeholderMap[], id: string | null | undefined) {
    if (!id) return undefined;
    for (const map of maps) {
        const s = map.stakeholders.find((x) => x.id === id);
        if (s) return {map, s};
    }
    return undefined;
}

/* ---------- вкладка ---------- */

export type StakeholdersProps = {
    maps: StakeholderMap[] | null;
    tasks: Task[];
    today: string;
    mapId: string | null;
    onOpenMap: (id: string | null) => void;
    personId: string | null;
    onOpenPerson: (id: string | null) => void;
    disabled: boolean;
    onSave: (m: StakeholderMap) => Promise<void> | null;
    onRemove: (m: StakeholderMap) => void;
    onOpenTask: (id: string) => void;
    onLinkTask: (taskId: string, stakeholderId: string | null) => void;
    onToggleTask: (t: Task) => void;
    /** покормить: создать задачу на следующий контакт */
    onFeed: (s: Stakeholder, title: string, date: string) => void;
    undoable: (title: string, undo: () => void) => void;
};

export function StakeholdersView(p: StakeholdersProps) {
    const [creating, setCreating] = React.useState(false);
    const map = p.maps?.find((m) => m.id === p.mapId);

    if (p.maps === null) {
        return (
            <div className="mv-loading">
                <Loader size="m" />
                <Text color="secondary">Загружаю карты стейкхолдеров…</Text>
            </div>
        );
    }
    if (map) return <MapPage {...p} map={map} />;

    const sorted = [...p.maps].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return (
        <>
            <Text variant="body-1" color="secondary" className="mv-hint">
                Карта стейкхолдеров для каждого продукта: кто влияет, кому интересно, когда вы говорили в последний раз и
                когда поговорите снова.
            </Text>
            <Button view="action" size="l" onClick={() => setCreating(true)} disabled={p.disabled} className="mv-map-new">
                <Icon data={Plus} size={16} />
                Новая карта стейкхолдеров
            </Button>
            {sorted.length === 0 ? (
                <div className="mv-maps-empty">
                    <img src={logo} alt="" className="mv-maps-empty__ant" />
                    <Text color="secondary">Карт пока нет. Муравьи сильны связями: начните с продукта, который важнее всего.</Text>
                </div>
            ) : (
                <ul className="mv-maps">
                    {sorted.map((m) => {
                        const hungry = m.stakeholders.filter((s) => openTasksOf(s, p.tasks).length === 0).length;
                        return (
                            <li key={m.id}>
                                <button type="button" className="mv-map-card" onClick={() => p.onOpenMap(m.id)}>
                                    <span className="mv-map-card__title">{m.title}</span>
                                    <Text variant="caption-2" color="secondary">
                                        {peopleWord(m.stakeholders.length)}
                                        {hungry > 0 && (
                                            <span className="mv-sh-card__hungry">
                                                {' '}
                                                · 🐒 {hungry} {plural(hungry, 'голоден', 'голодны', 'голодны')}
                                            </span>
                                        )}
                                    </Text>
                                    <MiniMatrix map={m} tasks={p.tasks} />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <TitleDialog
                open={creating}
                caption="Новая карта стейкхолдеров"
                apply="Создать"
                onClose={() => setCreating(false)}
                onApply={(title) => {
                    const m: StakeholderMap = {id: uid(), title, stakeholders: [], createdAt: new Date().toISOString()};
                    p.onSave(m);
                    setCreating(false);
                    p.onOpenMap(m.id);
                }}
            />
        </>
    );
}

function TitleDialog({
    open,
    caption,
    apply,
    initial = '',
    onClose,
    onApply,
}: {
    open: boolean;
    caption: string;
    apply: string;
    initial?: string;
    onClose: () => void;
    onApply: (title: string) => void;
}) {
    const [title, setTitle] = React.useState(initial);
    React.useEffect(() => {
        if (open) setTitle(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    const go = () => title.trim() && onApply(title.trim());
    const input = React.useRef<HTMLInputElement>(null);
    return (
        <Dialog open={open} onClose={onClose} size="s" aria-label={caption} initialFocus={input}>
            <Dialog.Header caption={caption} />
            <Dialog.Body>
                <TextInput
                    size="l"
                    controlRef={input}
                    placeholder="Продукт, например «Единый вход»"
                    value={title}
                    onUpdate={setTitle}
                    onKeyDown={(e) => e.key === 'Enter' && go()}
                />
            </Dialog.Body>
            <Dialog.Footer
                textButtonApply={apply}
                textButtonCancel="Отмена"
                propsButtonApply={{disabled: !title.trim()}}
                onClickButtonApply={go}
                onClickButtonCancel={onClose}
            />
        </Dialog>
    );
}

/** Матрица карты точками: видно расклад ещё до того, как карту открыли */
function MiniMatrix({map, tasks}: {map: StakeholderMap; tasks: Task[]}) {
    return (
        <span className="mv-sh-mini" aria-hidden="true">
            <span className="mv-sh-mini__q mv-sh-mini__q_manage" />
            {map.stakeholders.map((s) => (
                <span
                    key={s.id}
                    className={`mv-sh-mini__dot mv-sh_${s.attitude ?? 'neutral'}${
                        openTasksOf(s, tasks).length === 0 ? ' mv-sh-mini__dot_hungry' : ''
                    }`}
                    style={{left: `${s.interest * 100}%`, top: `${(1 - s.influence) * 100}%`}}
                />
            ))}
        </span>
    );
}

/* ---------- карта одного продукта ---------- */

function MapPage({map, ...p}: StakeholdersProps & {map: StakeholderMap}) {
    const [renaming, setRenaming] = React.useState(false);
    const [feeding, setFeeding] = React.useState<Stakeholder | null>(null);
    const person = map.stakeholders.find((s) => s.id === p.personId);

    // правки накладываем на самую свежую версию карты: текст сохраняется с задержкой
    const mapRef = React.useRef(map);
    mapRef.current = map;
    const saveMap = (patch: Partial<StakeholderMap>) => p.onSave({...mapRef.current, ...patch});
    const auto = useAutosave<StakeholderMap>(saveMap);
    const patchPerson = (id: string, patch: Partial<Stakeholder>) =>
        saveMap({stakeholders: mapRef.current.stakeholders.map((x) => (x.id === id ? {...x, ...patch} : x))});

    const add = () => {
        // новые встают чуть в стороне от центра, чтобы не ложиться друг на друга
        const n = map.stakeholders.length;
        const s: Stakeholder = {
            id: uid(),
            name: '',
            interest: 0.5 + 0.08 * Math.cos(n * 2.4),
            influence: 0.5 + 0.08 * Math.sin(n * 2.4),
            history: [],
            createdAt: new Date().toISOString(),
        };
        p.onSave({...map, stakeholders: [...map.stakeholders, s]});
        p.onOpenPerson(s.id);
    };
    const remove = (s: Stakeholder) => {
        p.onOpenPerson(null);
        p.onSave({...map, stakeholders: map.stakeholders.filter((x) => x.id !== s.id)});
        p.undoable(`«${s.name || 'Стейкхолдер'}» удалён с карты`, () => p.onSave({...map}));
    };
    const hungry = (s: Stakeholder) => openTasksOf(s, p.tasks).length === 0;
    const hungryCount = map.stakeholders.filter(hungry).length;
    // в списке сначала голодные, потом по зонам и имени
    const order: Zone[] = ['manage', 'satisfy', 'inform', 'monitor'];
    const list = [...map.stakeholders].sort(
        (a, b) =>
            Number(hungry(b)) - Number(hungry(a)) ||
            order.indexOf(zoneOf(a)) - order.indexOf(zoneOf(b)) ||
            a.name.localeCompare(b.name, 'ru'),
    );

    return (
        <div className="mv-map">
            <div className="mv-map__head">
                <Button view="flat" size="m" onClick={() => p.onOpenMap(null)}>
                    <Icon data={ArrowLeft} size={16} />
                    Все карты
                </Button>
                <div className="mv-map__actions">
                    <DropdownMenu
                        size="m"
                        items={[
                            {text: 'Переименовать', iconStart: <Icon data={Pencil} size={16} />, action: () => setRenaming(true)},
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
                <Text variant="header-2" as="h2" className="mv-sh-title">
                    {map.title}
                </Text>
                <div className="mv-map__sub">
                    <Text variant="body-1" color="secondary">
                        {peopleWord(map.stakeholders.length)}
                        {hungryCount > 0 && ` · 🐒 ждут контакта: ${hungryCount}`}
                    </Text>
                    <SaveStatus state={auto.state} idle="" />
                </div>
            </div>

            <div>
                <Button view="action" size="m" onClick={add} disabled={p.disabled}>
                    <Icon data={Plus} size={16} />
                    Стейкхолдер
                </Button>
            </div>

            <Matrix
                people={map.stakeholders}
                isHungry={hungry}
                onOpen={(id) => p.onOpenPerson(id)}
                onMove={(id, pos) =>
                    auto.save({
                        stakeholders: mapRef.current.stakeholders.map((x) => (x.id === id ? {...x, ...pos} : x)),
                    })
                }
            />
            {map.stakeholders.length > 0 && (
                <Text variant="caption-2" color="secondary" className="mv-map__hint">
                    Перетащите кружок в нужную зону. Цвет — отношение к продукту: зелёный союзник, серый нейтрален, красный
                    скептик.
                </Text>
            )}

            {list.length > 0 && (
                <ul className="mv-sh-list">
                    {list.map((s) => {
                        const open = openTasksOf(s, p.tasks);
                        const next = open
                            .map((t) => t.dueDate)
                            .filter(Boolean)
                            .sort()[0];
                        const last = lastContact(s);
                        const isHungry = open.length === 0;
                        return (
                            <li key={s.id} className={`mv-sh-row${isHungry ? ' mv-sh-row_hungry' : ''}`}>
                                <button type="button" className="mv-sh-row__main" onClick={() => p.onOpenPerson(s.id)}>
                                    <span className={`mv-sh-avatar mv-sh_${s.attitude ?? 'neutral'}`}>{initials(s.name)}</span>
                                    <span className="mv-sh-row__text">
                                        <span className="mv-sh-row__name">{s.name || 'Без имени'}</span>
                                        <Text variant="caption-2" color="secondary">
                                            {[s.role, zoneName(s), last ? `контакт ${agoText(last, p.today)}` : 'контактов не было']
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </Text>
                                    </span>
                                </button>
                                {isHungry ? (
                                    <button
                                        type="button"
                                        className="mv-hungry mv-hungry_button"
                                        title="Нет открытых задач. Покормите: запланируйте следующий контакт."
                                        onClick={() => setFeeding(s)}
                                        disabled={p.disabled}
                                    >
                                        <span className="mv-hungry__monkey" aria-hidden="true">
                                            🐒
                                        </span>
                                        Покорми меня
                                    </button>
                                ) : (
                                    <span className="mv-sh-row__next" title="Следующий шаг">
                                        <Icon data={Calendar} size={14} />
                                        {next ? dayText(next, p.today) : `${open.length} ${plural(open.length, 'задача', 'задачи', 'задач')}`}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <Dialog
                open={Boolean(person)}
                onClose={() => p.onOpenPerson(null)}
                hasCloseButton={false}
                size="m"
                aria-label="Стейкхолдер"
            >
                {person && (
                    <PersonDetails
                        key={person.id}
                        person={person}
                        today={p.today}
                        tasks={p.tasks.filter((t) => t.stakeholderId === person.id)}
                        linkable={p.tasks.filter((t) => !t.done && t.stakeholderId !== person.id)}
                        onSave={(patch) => patchPerson(person.id, patch)}
                        onDelete={() => remove(person)}
                        onClose={() => p.onOpenPerson(null)}
                        onOpenTask={p.onOpenTask}
                        onLinkTask={p.onLinkTask}
                        onToggleTask={p.onToggleTask}
                        onFeed={() => setFeeding(person)}
                        disabled={p.disabled}
                    />
                )}
            </Dialog>

            <ContactDialog
                person={feeding}
                today={p.today}
                onClose={() => setFeeding(null)}
                onDone={(r) => {
                    if (feeding && r.next) p.onFeed(feeding, r.next.title, r.next.date);
                    setFeeding(null);
                }}
            />

            <TitleDialog
                open={renaming}
                caption="Название карты"
                apply="Сохранить"
                initial={map.title}
                onClose={() => setRenaming(false)}
                onApply={(title) => {
                    saveMap({title});
                    setRenaming(false);
                }}
            />
        </div>
    );
}

/* ---------- матрица «влияние × интерес» ---------- */

const clamp = (v: number) => Math.min(0.97, Math.max(0.03, v));

function Matrix({
    people,
    isHungry,
    onOpen,
    onMove,
}: {
    people: Stakeholder[];
    isHungry: (s: Stakeholder) => boolean;
    onOpen: (id: string) => void;
    onMove: (id: string, pos: Pick<Stakeholder, 'interest' | 'influence'>) => void;
}) {
    const box = React.useRef<HTMLDivElement>(null);
    // пока тянем, кружок двигается сам, а записываем место, только когда отпустили
    const [drag, setDrag] = React.useState<{id: string; interest: number; influence: number} | null>(null);
    const start = React.useRef<{id: string; x: number; y: number; moved: boolean} | null>(null);

    const posAt = (e: React.PointerEvent) => {
        const r = box.current!.getBoundingClientRect();
        return {interest: clamp((e.clientX - r.left) / r.width), influence: clamp(1 - (e.clientY - r.top) / r.height)};
    };
    const down = (s: Stakeholder, e: React.PointerEvent) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = {id: s.id, x: e.clientX, y: e.clientY, moved: false};
    };
    const move = (e: React.PointerEvent) => {
        const st = start.current;
        if (!st) return;
        if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 5) return;
        st.moved = true;
        setDrag({id: st.id, ...posAt(e)});
    };
    const up = (e: React.PointerEvent) => {
        const st = start.current;
        start.current = null;
        if (!st) return;
        if (st.moved) {
            onMove(st.id, posAt(e));
            // держим кружок на новом месте, пока не придёт сохранённая карта
            window.setTimeout(() => setDrag(null), 50);
        } else {
            setDrag(null);
            onOpen(st.id);
        }
    };
    const key = (s: Stakeholder, e: React.KeyboardEvent) => {
        const d = 0.05;
        const step: Record<string, [number, number]> = {ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d]};
        const v = step[e.key];
        if (!v) return;
        e.preventDefault();
        onMove(s.id, {interest: clamp(s.interest + v[0]), influence: clamp(s.influence + v[1])});
    };

    return (
        <div className="mv-sh-matrix-wrap">
            <span className="mv-sh-axis mv-sh-axis_y">Влияние →</span>
            <div className="mv-sh-matrix" ref={box}>
                {(['satisfy', 'manage', 'monitor', 'inform'] as Zone[]).map((z) => (
                    <div key={z} className={`mv-sh-zone mv-sh-zone_${z}`}>
                        <span className="mv-sh-zone__name">{ZONES[z].name}</span>
                    </div>
                ))}
                {people.length === 0 && (
                    <div className="mv-sh-matrix__empty">
                        <Text color="secondary">Добавьте первого стейкхолдера — он появится в центре, а дальше перетащите его в свою зону.</Text>
                    </div>
                )}
                {people.map((s) => {
                    const pos = drag?.id === s.id ? drag : s;
                    const hungry = isHungry(s);
                    return (
                        <button
                            key={s.id}
                            type="button"
                            className={`mv-sh-dot${drag?.id === s.id ? ' mv-sh-dot_drag' : ''}${hungry ? ' mv-sh-dot_hungry' : ''}`}
                            style={{left: `${pos.interest * 100}%`, top: `${(1 - pos.influence) * 100}%`}}
                            onPointerDown={(e) => down(s, e)}
                            onPointerMove={move}
                            onPointerUp={up}
                            onPointerCancel={() => {
                                start.current = null;
                                setDrag(null);
                            }}
                            onKeyDown={(e) => key(s, e)}
                            title={`${s.name || 'Без имени'} · ${ZONES[zoneOf(pos)].name}${hungry ? ' · ждёт контакта' : ''}`}
                            aria-label={`${s.name || 'Без имени'}, ${ZONES[zoneOf(pos)].name}. Стрелки двигают по матрице`}
                        >
                            <span className={`mv-sh-avatar mv-sh_${s.attitude ?? 'neutral'}`}>{initials(s.name)}</span>
                            {hungry && (
                                <span className="mv-sh-dot__monkey" aria-hidden="true">
                                    🐒
                                </span>
                            )}
                            <span className="mv-sh-dot__name">{s.name || 'Без имени'}</span>
                        </button>
                    );
                })}
            </div>
            <span className="mv-sh-axis mv-sh-axis_x">Интерес →</span>
        </div>
    );
}

/* ---------- карточка стейкхолдера ---------- */

function PersonDetails({
    person,
    today,
    tasks,
    linkable,
    onSave,
    onDelete,
    onClose,
    onOpenTask,
    onLinkTask,
    onToggleTask,
    onFeed,
    disabled,
}: {
    person: Stakeholder;
    today: string;
    tasks: Task[];
    linkable: Task[];
    onSave: (p: Partial<Stakeholder>) => Promise<void> | null;
    onDelete: () => void;
    onClose: () => void;
    onOpenTask: (id: string) => void;
    onLinkTask: (taskId: string, stakeholderId: string | null) => void;
    onToggleTask: (t: Task) => void;
    onFeed: () => void;
    disabled: boolean;
}) {
    const [name, setName] = React.useState(person.name);
    const [role, setRole] = React.useState(person.role ?? '');
    const [contact, setContact] = React.useState(person.contact ?? '');
    const auto = useAutosave<Stakeholder>(onSave);
    const close = () => {
        auto.flush();
        onClose();
    };
    const open = tasks.filter((t) => !t.done);
    const sortedTasks = [...tasks].sort(
        (a, b) => Number(a.done) - Number(b.done) || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'),
    );
    const history = [...person.history].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const zone = ZONES[zoneOf(person)];

    return (
        <div className="mv-details mv-details_popup">
            <div className="mv-details__head">
                <Label theme="info" size="s" icon={<Icon data={Persons} size={12} />}>
                    Стейкхолдер
                </Label>
                <SaveStatus state={auto.state} idle={zone.name} />
                <div className="mv-details__actions">
                    <ActionTooltip title="Удалить с карты">
                        <Button view="flat-danger" size="m" onClick={onDelete} aria-label="Удалить стейкхолдера">
                            <Icon data={TrashBin} size={16} />
                        </Button>
                    </ActionTooltip>
                </div>
                <Button view="flat" size="m" onClick={close} aria-label="Закрыть" className="mv-details__close">
                    <Icon data={Xmark} size={16} />
                </Button>
            </div>

            <div className="mv-sh-head">
                <span className={`mv-sh-avatar mv-sh-avatar_l mv-sh_${person.attitude ?? 'neutral'}`}>{initials(name)}</span>
                <TextInput
                    view="clear"
                    size="xl"
                    className="mv-map__title"
                    autoFocus={!person.name}
                    value={name}
                    onUpdate={(v) => {
                        setName(v);
                        auto.schedule({name: v.trim()});
                    }}
                    onBlur={auto.flush}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    placeholder="Имя и фамилия"
                    aria-label="Имя"
                />
            </div>

            <div className="mv-sh-fields">
                <TextInput
                    size="m"
                    label="Роль"
                    value={role}
                    onUpdate={(v) => {
                        setRole(v);
                        auto.schedule({role: v.trim()});
                    }}
                    onBlur={auto.flush}
                    placeholder="CPO продукта «Оплаты»"
                />
                <TextInput
                    size="m"
                    label="Контакт"
                    value={contact}
                    onUpdate={(v) => {
                        setContact(v);
                        auto.schedule({contact: v.trim()});
                    }}
                    onBlur={auto.flush}
                    placeholder="Почта, телеграм"
                />
            </div>

            <section className="mv-field">
                <Text variant="subheader-1">Отношение к продукту</Text>
                <SegmentedRadioGroup
                    size="m"
                    value={person.attitude ?? 'neutral'}
                    onUpdate={(v) => auto.save({attitude: v as Attitude})}
                    options={(Object.keys(ATTITUDES) as Attitude[]).map((a) => ({value: a, content: ATTITUDES[a]}))}
                />
                <Text variant="caption-2" color="secondary">
                    Зона на карте: {zone.name.toLowerCase()} ({zone.hint.toLowerCase()}). Выходить на связь — примерно раз в{' '}
                    {zone.every === 7 ? 'неделю' : zone.every === 14 ? 'две недели' : 'месяц'}.
                </Text>
            </section>

            <section className="mv-field">
                <div className="mv-subtasks__head">
                    <Text variant="subheader-1">Следующие шаги</Text>
                    {tasks.length > 0 && (
                        <Text variant="caption-2" color="secondary">
                            открыто {open.length} из {tasks.length}
                        </Text>
                    )}
                </div>
                {open.length === 0 && (
                    <div className="mv-sh-hungry">
                        <span className="mv-hungry__monkey" aria-hidden="true">
                            🐒
                        </span>
                        <Text>Открытых задач нет — стейкхолдер голоден. Запланируйте следующий контакт.</Text>
                    </div>
                )}
                {sortedTasks.length > 0 && (
                    <ul className="mv-subtasks">
                        {sortedTasks.map((c) => (
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
                                {c.dueDate && !c.done && <DueChip day={c.dueDate} today={today} />}
                                <ActionTooltip title="Отвязать от стейкхолдера">
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
                )}
                <div className="mv-sh-actions">
                    {open.length === 0 ? (
                        <Button view="action" size="m" onClick={onFeed} disabled={disabled}>
                            🍌 Покормить
                        </Button>
                    ) : (
                        <Button view="outlined" size="m" onClick={onFeed} disabled={disabled}>
                            <Icon data={Calendar} size={16} />
                            Запланировать контакт
                        </Button>
                    )}
                    {linkable.length > 0 && (
                        <Select
                            value={[]}
                            filterable={linkable.length > 7}
                            filterPlaceholder="Найти задачу"
                            popupWidth={320}
                            onUpdate={([v]) => v && onLinkTask(v, person.id)}
                            options={linkable.map((t) => ({value: t.id, content: t.title}))}
                            renderControl={({ref, triggerProps}) => (
                                <Button ref={ref as React.Ref<HTMLButtonElement>} {...triggerProps} view="outlined" size="m">
                                    <Icon data={Plus} size={16} />
                                    Привязать задачу
                                </Button>
                            )}
                        />
                    )}
                </div>
            </section>

            <section className="mv-field">
                <Text variant="subheader-1">
                    История взаимодействий{person.history.length ? ` · ${person.history.length}` : ''}
                </Text>
                <HistoryForm today={today} onAdd={(h) => auto.save({history: [...person.history, h]})} />
                {history.length > 0 ? (
                    <ol className="mv-sh-history">
                        {history.map((h) => (
                            <li key={h.id} className="mv-sh-event">
                                <span className="mv-sh-event__mark" aria-hidden="true">
                                    {KINDS[h.kind].mark}
                                </span>
                                <div className="mv-sh-event__body">
                                    <Text variant="caption-2" color="secondary">
                                        {fmtLong.format(asDate(h.date))} · {KINDS[h.kind].name}
                                        {h.outcome && ` · ${OUTCOMES[h.outcome].mark} ${OUTCOMES[h.outcome].name.toLowerCase()}`}
                                    </Text>
                                    {h.text && <Text className="mv-sh-event__text">{h.text}</Text>}
                                </div>
                                <ActionTooltip title="Удалить запись">
                                    <Button
                                        view="flat-secondary"
                                        size="s"
                                        className="mv-subtask__unlink"
                                        onClick={() => auto.save({history: person.history.filter((x) => x.id !== h.id)})}
                                        aria-label="Удалить запись"
                                    >
                                        <Icon data={TrashBin} size={14} />
                                    </Button>
                                </ActionTooltip>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <Text color="secondary" className="mv-subtasks__empty">
                        Здесь копится история: встречи, звонки, письма. Запись появляется и сама, когда вы закрываете задачу
                        стейкхолдера и отвечаете на «Как прошло?».
                    </Text>
                )}
            </section>

            <section className="mv-field">
                <Text variant="subheader-1">Заметки</Text>
                <DescriptionEditor
                    value={person.description ?? ''}
                    onChange={(v) => auto.schedule({description: v})}
                    onSubmit={auto.flush}
                    placeholder="Что важно этому человеку, чего он ждёт от продукта, о чём договорились"
                />
            </section>
        </div>
    );
}

export function DueChip({day, today}: {day: string; today: string}) {
    const late = day < today;
    return (
        <span
            className={`mv-due${day === today ? ' mv-due_today' : ''}${late ? ' mv-due_late' : ''}`}
            title={late ? `Дата прошла: ${fmtLong.format(asDate(day))}` : `Дата: ${fmtLong.format(asDate(day))}`}
        >
            <Icon data={Calendar} size={12} />
            {dayText(day, today)}
        </span>
    );
}

/** Тип, итог и текст записи в историю — общие для карточки и для «Как прошло?» */
function ContactFields({
    kind,
    outcome,
    text,
    onKind,
    onOutcome,
    onText,
    autoFocus,
    placeholder,
}: {
    kind: ContactKind;
    outcome?: Outcome;
    text: string;
    onKind: (k: ContactKind) => void;
    onOutcome: (o: Outcome | undefined) => void;
    onText: (t: string) => void;
    autoFocus?: boolean;
    placeholder: string;
}) {
    return (
        <>
            <div className="mv-sh-outcome" role="radiogroup" aria-label="Как общались">
                {(Object.keys(KINDS) as ContactKind[]).map((k) => (
                    <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        className={`mv-sh-outcome__btn${kind === k ? ' mv-sh-outcome__btn_on' : ''}`}
                        onClick={() => onKind(k)}
                    >
                        {KINDS[k].mark} {KINDS[k].name}
                    </button>
                ))}
            </div>
            <div className="mv-sh-outcome" role="group" aria-label="Итог">
                {(Object.keys(OUTCOMES) as Outcome[]).map((o) => (
                    <button
                        key={o}
                        type="button"
                        className={`mv-sh-outcome__btn${outcome === o ? ' mv-sh-outcome__btn_on' : ''}`}
                        aria-pressed={outcome === o}
                        onClick={() => onOutcome(outcome === o ? undefined : o)}
                    >
                        {OUTCOMES[o].mark} {OUTCOMES[o].name}
                    </button>
                ))}
            </div>
            <TextArea size="m" minRows={2} maxRows={8} value={text} onUpdate={onText} placeholder={placeholder} autoFocus={autoFocus} />
        </>
    );
}

function HistoryForm({today, onAdd}: {today: string; onAdd: (h: Interaction) => void}) {
    const [openForm, setOpenForm] = React.useState(false);
    const [date, setDate] = React.useState(today);
    const [kind, setKind] = React.useState<ContactKind>('meeting');
    const [outcome, setOutcome] = React.useState<Outcome | undefined>();
    const [text, setText] = React.useState('');
    if (!openForm) {
        return (
            <div>
                <Button view="outlined" size="m" onClick={() => setOpenForm(true)}>
                    <Icon data={Plus} size={16} />
                    Добавить запись
                </Button>
            </div>
        );
    }
    const add = () => {
        onAdd({id: uid(), date, kind, text: text.trim(), ...(outcome ? {outcome} : {})});
        setText('');
        setOutcome(undefined);
        setOpenForm(false);
    };
    return (
        <div className="mv-sh-form">
            <label className="mv-date-field">
                <Text variant="caption-2" color="secondary">
                    Когда
                </Text>
                <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <ContactFields
                kind={kind}
                outcome={outcome}
                text={text}
                onKind={setKind}
                onOutcome={setOutcome}
                onText={setText}
                autoFocus
                placeholder="О чём говорили, что решили"
            />
            <div className="mv-sh-actions">
                <Button view="action" size="m" onClick={add}>
                    Записать
                </Button>
                <Button view="flat" size="m" onClick={() => setOpenForm(false)}>
                    Отмена
                </Button>
            </div>
        </div>
    );
}

/* ---------- «Покормить» и «Как прошло?» ---------- */

export type ContactResult = {
    /** запись в историю — только для «Как прошло?» */
    entry?: Interaction;
    next?: {title: string; date: string};
};

/**
 * Без after — «Покормить»: следующий контакт задачей с датой.
 * С after — «Как прошло?» после закрытия задачи: запись в историю и, если надо, следующий контакт.
 */
export function ContactDialog({
    person,
    today,
    after,
    hasOtherTasks = false,
    onClose,
    onDone,
}: {
    person: Stakeholder | null;
    today: string;
    after?: Task;
    hasOtherTasks?: boolean;
    onClose: () => void;
    onDone: (r: ContactResult) => void;
}) {
    const every = person ? ZONES[zoneOf(person)].every : 14;
    const [kind, setKind] = React.useState<ContactKind>('meeting');
    const [outcome, setOutcome] = React.useState<Outcome | undefined>();
    const [text, setText] = React.useState('');
    const [plan, setPlan] = React.useState(true);
    const [title, setTitle] = React.useState('');
    const [date, setDate] = React.useState(addDays(today, every));
    React.useEffect(() => {
        if (!person) return;
        setKind('meeting');
        setOutcome(undefined);
        setText('');
        setPlan(!after || !hasOtherTasks);
        setTitle(`Связаться: ${person.name || 'стейкхолдер'}`);
        setDate(addDays(today, every));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [person?.id, after?.id]);

    const quick: [string, number][] = [
        ['Завтра', 1],
        ['Через неделю', 7],
        ['Через 2 недели', 14],
        ['Через месяц', 30],
    ];
    const valid = !plan || (title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(date));
    const done = () => {
        if (!valid) return;
        onDone({
            entry: after
                ? {id: uid(), date: today, kind, text: text.trim(), taskId: after.id, ...(outcome ? {outcome} : {})}
                : undefined,
            next: plan ? {title: title.trim(), date} : undefined,
        });
    };
    const who = person?.name || 'стейкхолдер';
    const caption = after ? `Как прошло? ${who}` : `Покормить: ${who}`;

    return (
        <Dialog open={Boolean(person)} onClose={onClose} size="s" aria-label={caption}>
            <Dialog.Header caption={caption} />
            <Dialog.Body>
                <div className="mv-sh-contact">
                    {after ? (
                        <>
                            <Text color="secondary">
                                Задача «{after.title}» закрыта. Пара слов попадёт в историю стейкхолдера.
                            </Text>
                            <ContactFields
                                kind={kind}
                                outcome={outcome}
                                text={text}
                                onKind={setKind}
                                onOutcome={setOutcome}
                                onText={setText}
                                autoFocus
                                placeholder="О чём договорились, что дальше"
                            />
                            <Checkbox size="m" checked={plan} onUpdate={setPlan}>
                                Запланировать следующий контакт
                            </Checkbox>
                        </>
                    ) : (
                        <Text color="secondary">
                            Обезьяна сыта, когда у стейкхолдера есть следующий шаг. Задача подождёт в бэклоге и сама придёт в
                            «Сегодня» в выбранный день.
                        </Text>
                    )}
                    {plan && (
                        <div className="mv-sh-next">
                            <TextInput
                                size="m"
                                label="Что дальше"
                                value={title}
                                onUpdate={setTitle}
                                autoFocus={!after}
                                onKeyDown={(e) => e.key === 'Enter' && done()}
                            />
                            <div className="mv-sh-quick">
                                {quick.map(([label, n]) => {
                                    const d = addDays(today, n);
                                    return (
                                        <button
                                            key={n}
                                            type="button"
                                            className={`mv-sh-quick__btn${date === d ? ' mv-sh-quick__btn_on' : ''}`}
                                            onClick={() => setDate(d)}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                                <input
                                    type="date"
                                    className="mv-sh-quick__date"
                                    value={date}
                                    min={today}
                                    onChange={(e) => e.target.value && setDate(e.target.value)}
                                    aria-label="Дата следующего контакта"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </Dialog.Body>
            <Dialog.Footer
                textButtonApply={after ? 'Сохранить' : '🍌 Покормить'}
                textButtonCancel={after ? 'Пропустить' : 'Отмена'}
                propsButtonApply={{disabled: !valid}}
                onClickButtonApply={done}
                onClickButtonCancel={onClose}
            />
        </Dialog>
    );
}
