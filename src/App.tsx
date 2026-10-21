import React from 'react';
import {
    ActionTooltip,
    Alert,
    Button,
    Dialog,
    DropdownMenu,
    Icon,
    Label,
    Loader,
    Menu,
    Popup,
    Select,
    useToaster,
    Tab,
    TabList,
    Text,
    TextArea,
    TextInput,
} from '@gravity-ui/uikit';
import {
    ArrowUturnCcwLeft,
    BarsUnaligned,
    CircleCheck,
    Flag,
    Link,
    LinkSlash,
    Grip,
    Comment as CommentIcon,
    Plus,
    Sun,
    Tag as TagIcon,
    Target,
    TextAlignLeft,
    TrashBin,
    Tray,
    Xmark,
} from '@gravity-ui/icons';

import type {Backend} from './store';
import {pickBackend} from './store';
import type {LoginOptions} from './store';
import {burst} from './confetti';
import {TAG_THEMES, dayKey, effectiveList, hungerOf, sortKey, uid} from './types';
import type {ListKind, Milestone, Roadmap, Tag, TagTheme, Task} from './types';
import {BackupMenu} from './Backup';
import {BacklogBoard} from './BacklogBoard';
import {DescriptionEditor} from './DescriptionEditor';
import {RoadmapsView, datesText} from './Roadmaps';
import {SortableList, useSortableRow} from './SortableList';
import logo from './assets/logo.png';

type View = ListKind | 'done' | 'roadmap';

const LIST_NAMES: Record<ListKind, string> = {today: 'Сегодня', focus: 'Фокус', backlog: 'Бэклог'};
const THEME_NAMES: Record<TagTheme, string> = {
    info: 'Синий',
    success: 'Зелёный',
    warning: 'Жёлтый',
    danger: 'Красный',
    utility: 'Фиолетовый',
    normal: 'Серый',
    unknown: 'Графит',
};

const fmtDateTime = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
});
const fmtDate = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long'});
const fmtTime = new Intl.DateTimeFormat('ru-RU', {hour: '2-digit', minute: '2-digit'});
const fmtToday = new Intl.DateTimeFormat('ru-RU', {weekday: 'long', day: 'numeric', month: 'long'});

function useToday() {
    const [today, setToday] = React.useState(dayKey());
    React.useEffect(() => {
        const tick = () => setToday(dayKey());
        const id = window.setInterval(tick, 60_000);
        document.addEventListener('visibilitychange', tick);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', tick);
        };
    }, []);
    return today;
}

export function App() {
    const [backend, setBackend] = React.useState<Backend | null>(null);
    const [login, setLogin] = React.useState<{opts: LoginOptions; connect: (b: Backend) => void} | null>(null);
    const [tasks, setTasks] = React.useState<Task[] | null>(null);
    const [tags, setTags] = React.useState<Tag[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    // в адресе: #today, #roadmap или #roadmap/<id карты>
    const [view, setView] = React.useState<View>(() => {
        const h = window.location.hash.slice(1).split('/')[0];
        return (['today', 'focus', 'backlog', 'done', 'roadmap'] as View[]).includes(h as View) ? (h as View) : 'today';
    });
    const [roadmaps, setRoadmaps] = React.useState<Roadmap[] | null>(null);
    const [mapId, setMapId] = React.useState<string | null>(() => {
        const [h, id] = window.location.hash.slice(1).split('/');
        return h === 'roadmap' && id ? id : null;
    });
    const [milestoneId, setMilestoneId] = React.useState<string | null>(null);
    const [openId, setOpenId] = React.useState<string | null>(null);
    // новая задача: черновик живёт только в окне, в хранилище попадает, как только появится название
    const [draft, setDraft] = React.useState<Task | null>(null);
    const draftRef = React.useRef<Task | null>(null);
    const newTitleRef = React.useRef<HTMLTextAreaElement>(null);
    const [tagsOpen, setTagsOpen] = React.useState(false);
    const [tagFilter, setTagFilter] = React.useState<string[]>(() => {
        try {
            const v = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '[]');
            return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
        } catch {
            return [];
        }
    });
    React.useEffect(() => {
        try {
            localStorage.setItem(FILTER_KEY, JSON.stringify(tagFilter));
        } catch {
            /* без памяти фильтра */
        }
    }, [tagFilter]);
    const [notice, setNotice] = React.useState<string | null>(null);
    const [completing, setCompleting] = React.useState<Set<string>>(new Set());
    // номер последней кормёжки голодной обезьяны: новый номер перезапускает анимацию
    const [feast, setFeast] = React.useState(0);
    const toaster = useToaster();
    // действие уже выполнено; в уведомлении можно его отменить
    const undoable = (title: string, undo: () => void) => {
        const name = 'undo-' + uid();
        toaster.add({
            name,
            title,
            theme: 'normal',
            autoHiding: 7000,
            actions: [{label: 'Отменить', view: 'outlined', removeAfterClick: true, onClick: undo}],
        });
    };
    const today = useToday();

    const tasksRef = React.useRef<Task[]>([]);
    tasksRef.current = tasks ?? [];
    const tagsRef = React.useRef<Tag[]>([]);
    tagsRef.current = tags;

    React.useEffect(() => {
        let unsub = () => {};
        let alive = true;
        const connect = (b: Backend) => {
            if (!alive) return;
            setLogin(null);
            setBackend(b);
            unsub = b.subscribe(setTasks, setTags, setError, setRoadmaps);
        };
        pickBackend().then((r) => {
            if (!alive) return;
            if ('backend' in r) connect(r.backend);
            else setLogin({opts: r, connect});
        });
        return () => {
            alive = false;
            unsub();
        };
    }, []);

    const run = React.useCallback((p: Promise<void>) => {
        p.catch((e: Error) => setError(e.message));
    }, []);

    const patch = React.useCallback(
        (id: string, p: Partial<Task>): Promise<void> => {
            const t = tasksRef.current.find((x) => x.id === id);
            if (!t || !backend) return Promise.resolve();
            // перестановка внутри списка и сохранение без изменений — не действие, обезьяну не кормят
            const acted = (Object.keys(p) as (keyof Task)[]).some(
                (k) => k !== 'order' && JSON.stringify(t[k] ?? null) !== JSON.stringify(p[k] ?? null),
            );
            if (!acted) {
                const pr = backend.saveTask({...t, ...p});
                run(pr);
                return pr;
            }
            const now = new Date().toISOString();
            const pr = backend.saveTask({...t, ...p, touchedAt: now});
            run(pr);
            // фокусную задачу кормят только её подзадачи
            if (t.list !== 'focus' && hungerOf(t, tasksRef.current) !== null) setFeast((n) => n + 1);
            return pr;
        },
        [backend, run],
    );

    const openDraft = (list: 'backlog' | 'focus') => {
        const t: Task = {
            id: uid(),
            title: '',
            description: '',
            list,
            plannedFor: null,
            plannedAt: null,
            tagIds: [],
            comments: [],
            done: false,
            doneAt: null,
            createdAt: new Date().toISOString(),
        };
        draftRef.current = t;
        setOpenId(null);
        setDraft(t);
    };
    // правка черновика: пока нет названия, ничего не пишем (null — «ещё не сохраняем»);
    // одна и та же запись с тем же id, поэтому дублей не будет
    const patchDraft = (p: Partial<Task>): Promise<void> | null => {
        const cur = draftRef.current;
        if (!cur) return null;
        const d = {...cur, ...p};
        draftRef.current = d;
        setDraft((x) => (x && x.id === d.id ? d : x));
        if (!d.title.trim() || !backend) return null;
        const pr = backend.saveTask(d);
        run(pr);
        return pr;
    };
    const closeCard = () => {
        setOpenId(null);
        setDraft(null);
    };

    // при переносе в другой список ручной порядок сбрасывается: в «Сегодня» и «Фокус» задача встаёт вниз, в бэклоге — по дате
    const planToday = (id: string) =>
        patch(id, {list: 'today', plannedFor: today, plannedAt: new Date().toISOString(), order: null});
    const toBacklog = (id: string) => patch(id, {list: 'backlog', plannedFor: null, plannedAt: null, order: null});
    // фокусная задача всегда главная — сама подзадачей быть не может
    const toFocus = (id: string) =>
        patch(id, {list: 'focus', plannedFor: null, plannedAt: null, order: null, parentId: null});

    // задача id встала на своё место в упорядоченном списке moved: новый ключ — середина между соседями
    const placeIn = (list: ListKind, moved: Task[], id: string, extra: Partial<Task> = {}) => {
        if (!backend) return;
        const to = moved.findIndex((x) => x.id === id);
        const prev = moved[to - 1] ? sortKey(moved[to - 1], list) : null;
        const next = moved[to + 1] ? sortKey(moved[to + 1], list) : null;
        const key =
            prev != null && next != null ? (prev + next) / 2 : prev != null ? prev + 1024 : (next ?? 0) - 1024;
        if ((prev != null && key <= prev) || (next != null && key >= next)) {
            // ключи слиплись — перенумеровываем весь список
            moved.forEach((x, i) =>
                patch(x.id, {...(x.id === id ? extra : x.list !== list ? listFields(list) : {}), order: i * 1024}),
            );
        } else {
            patch(id, {...extra, order: key});
        }
    };
    const listFields = (list: ListKind): Partial<Task> =>
        list === 'today'
            ? {list: 'today', plannedFor: today, plannedAt: new Date().toISOString()}
            : {list, plannedFor: null, plannedAt: null};

    // перетащили внутри обычного списка
    const reorder = (list: ListKind, items: Task[], from: number, to: number) => {
        if (from === to) return;
        const moved = [...items];
        const [t] = moved.splice(from, 1);
        moved.splice(to, 0, t);
        placeIn(list, moved, t.id, t.list !== list ? listFields(list) : {});
    };

    // доска «бэклог / сегодня»: задача оказалась в колонке col на позиции index
    const placeOnBoard = (id: string, col: 'backlog' | 'today', ids: string[]) => {
        const byId = new Map(tasksRef.current.map((t) => [t.id, t]));
        const moved = ids.map((x) => byId.get(x)).filter(Boolean) as Task[];
        const t = byId.get(id);
        if (!t) return;
        const sameList = col === 'today' ? t.list === 'today' && t.plannedFor === today : t.list === 'backlog';
        placeIn(col, moved, id, sameList ? {} : listFields(col));
    };

    const complete = (id: string, from?: HTMLElement | null) => {
        if (from) {
            const r = from.getBoundingClientRect();
            burst(r.left + r.width / 2, r.top + r.height / 2);
        } else {
            burst(window.innerWidth / 2, window.innerHeight / 3);
        }
        setCompleting((s) => new Set(s).add(id));
        const t = tasksRef.current.find((x) => x.id === id);
        window.setTimeout(() => {
            patch(id, {done: true, doneAt: new Date().toISOString()});
            if (t) undoable(`Задача «${t.title}» закрыта`, () => patch(id, {done: false, doneAt: null}));
            window.setTimeout(
                () =>
                    setCompleting((s) => {
                        const n = new Set(s);
                        n.delete(id);
                        return n;
                    }),
                400,
            );
        }, 950);
    };

    const reopen = (id: string) => patch(id, {done: false, doneAt: null});

    // удаление без подтверждения: сразу убираем, а в уведомлении можно вернуть
    const removeTask = (id: string) => {
        if (!backend) return;
        const t = tasksRef.current.find((x) => x.id === id);
        if (openId === id) setOpenId(null);
        run(backend.removeTask(id));
        if (t) undoable(`Задача «${t.title}» удалена`, () => run(backend.saveTask(t)));
    };

    const removeTag = (tagId: string) => {
        if (!backend) return;
        const tag = tagsRef.current.find((x) => x.id === tagId);
        const used = tasksRef.current.filter((t) => t.tagIds.includes(tagId)).map((t) => t.id);
        for (const t of tasksRef.current) {
            if (t.tagIds.includes(tagId)) {
                run(backend.saveTask({...t, tagIds: t.tagIds.filter((x) => x !== tagId)}));
            }
        }
        run(backend.removeTag(tagId));
        if (tag) {
            undoable(`Тег «${tag.name}» удалён`, () => {
                run(backend.saveTag(tag));
                // возвращаем тег задачам, не трогая остальные их правки
                for (const t of tasksRef.current) {
                    if (used.includes(t.id) && !t.tagIds.includes(tagId)) {
                        run(backend.saveTask({...t, tagIds: [...t.tagIds, tagId]}));
                    }
                }
            });
        }
    };

    const switchView = (v: string, map: string | null = null) => {
        setView(v as View);
        setMapId(map);
        setMilestoneId(null);
        try {
            history.replaceState(null, '', '#' + v + (map ? '/' + map : ''));
        } catch {
            /* без адресной строки */
        }
    };

    const removeRoadmap = (r: Roadmap) => {
        if (!backend) return;
        run(backend.removeRoadmap(r.id));
        undoable(`Дорожная карта «${r.title}» удалена`, () => run(backend.saveRoadmap(r)));
    };
    // все вехи для поля «Веха» в карточке задачи
    const milestones = (roadmaps ?? []).flatMap((map) => map.milestones.map((m) => ({map, m})));
    const milestoneOf = (t: Task) => (t.milestoneId ? milestones.find((x) => x.m.id === t.milestoneId) : undefined);

    const all = tasks ?? [];
    // фильтр по тегам: задача видна, если у неё есть хотя бы один из выбранных тегов
    const tagIdsAll = new Set(tags.map((t) => t.id));
    const activeFilter = tagFilter.filter((id) => tagIdsAll.has(id));
    const filtering = activeFilter.length > 0;
    // удалённые теги выкидываем из сохранённого фильтра (когда теги уже загрузились)
    React.useEffect(() => {
        if (tags.length && activeFilter.length !== tagFilter.length) setTagFilter(activeFilter);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tags]);
    const matches = (t: Task) => !filtering || t.tagIds.some((id) => activeFilter.includes(id));
    const open = all.filter((t) => !t.done && matches(t));
    const byList = (l: ListKind) => open.filter((t) => effectiveList(t, today) === l);
    const lists = {
        today: byList('today').sort((a, b) => sortKey(a, 'today') - sortKey(b, 'today')),
        focus: byList('focus').sort((a, b) => sortKey(a, 'focus') - sortKey(b, 'focus')),
        backlog: byList('backlog').sort((a, b) => sortKey(a, 'backlog') - sortKey(b, 'backlog')),
        done: all.filter((t) => t.done && matches(t)).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    };
    const shown = view === 'roadmap' ? [] : lists[view];
    // на сегодня пусто (и фильтр ничего не прячет) — показываем большой экран «Спланировать день»
    const emptyDay = view === 'today' && tasks !== null && lists.today.length === 0 && !filtering;
    const tagMap = new Map(tags.map((t) => [t.id, t]));
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const cardId = openId ?? draft?.id ?? null;
    const cardStored = all.find((t) => t.id === cardId) ?? null;
    const cardTask = cardStored ?? (draft && draft.id === cardId ? draft : null);

    // связи «фокусная задача → подзадачи»: главная всегда одна и всегда фокусная
    const byId = new Map(all.map((t) => [t.id, t]));
    const focusTasks = all.filter((t) => t.list === 'focus' && !t.done);
    const parentOf = (t: Task) => {
        const p = t.parentId ? byId.get(t.parentId) : undefined;
        return p && p.list === 'focus' && t.list !== 'focus' ? p : undefined;
    };
    const childrenOf = (id: string) => all.filter((t) => t.parentId === id && t.list !== 'focus');
    const progressOf = (t: Task) => {
        if (t.list !== 'focus') return undefined;
        const kids = childrenOf(t.id);
        return kids.length ? {done: kids.filter((k) => k.done).length, total: kids.length} : undefined;
    };
    const addChild = (parentId: string, title: string) => {
        if (!backend) return;
        run(
            backend.saveTask({
                id: uid(),
                title,
                description: '',
                list: 'backlog',
                plannedFor: null,
                plannedAt: null,
                tagIds: [],
                comments: [],
                done: false,
                doneAt: null,
                createdAt: new Date().toISOString(),
                parentId,
            }),
        );
    };
    const doneToday = all.filter((t) => t.done && t.doneAt && dayKey(new Date(t.doneAt)) === today).length;

    const createTag = (name: string): Tag => {
        const tag: Tag = {
            id: uid(),
            name,
            theme: TAG_THEMES[tags.length % TAG_THEMES.length],
            createdAt: new Date().toISOString(),
        };
        if (backend) run(backend.saveTag(tag));
        return tag;
    };

    const row = (t: Task, sortable = true) => (
        <TaskRow
            sortable={sortable}
            key={t.id}
            task={t}
            list={effectiveList(t, today)}
            tagMap={tagMap}
            completing={completing.has(t.id)}
            onOpen={() => setOpenId(t.id)}
            onComplete={(el) => complete(t.id, el)}
            onReopen={() => reopen(t.id)}
            onPlan={() => planToday(t.id)}
            onBacklog={() => toBacklog(t.id)}
            onFocus={() => toFocus(t.id)}
            onDelete={() => removeTask(t.id)}
            parent={parentOf(t)}
            progress={progressOf(t)}
            onOpenParent={(id) => setOpenId(id)}
            hungry={hungerOf(t, all)}
        />
    );

    if (login) return <LoginScreen opts={login.opts} onReady={login.connect} />;

    return (
        <div className={`mv-app${view === 'backlog' || view === 'roadmap' ? ' mv-app_wide' : ''}`}>
            {feast > 0 && <MonkeyFeast key={feast} onEnd={() => setFeast(0)} />}
            <header className="mv-header">
                <div className="mv-brand">
                    <img src={logo} alt="" className="mv-mark" />
                    <div>
                        <Text variant="header-1" as="h1" className="mv-title">
                            Муравей
                        </Text>
                        <Text variant="body-1" color="secondary" className="mv-date">
                            {fmtToday.format(new Date())}
                            {doneToday > 0 && ` · закрыто сегодня: ${doneToday}`}
                        </Text>
                    </div>
                </div>
                <div className="mv-header__actions">
                    <Button view="outlined" size="m" onClick={() => setTagsOpen(true)}>
                        <Icon data={TagIcon} size={16} />
                        Теги
                    </Button>
                    <BackupMenu
                        backend={backend}
                        tasks={all}
                        tags={tags}
                        roadmaps={roadmaps ?? []}
                        onResult={(r) => (r.ok ? setNotice(r.message) : setError(r.message))}
                    />
                </div>
            </header>

            <TabList value={view} onUpdate={(v) => switchView(v)} size="l" contentOverflow="scroll" className="mv-tabs">
                <Tab value="today" icon={<Icon data={Sun} size={16} />} counter={lists.today.length}>
                    Сегодня
                </Tab>
                <Tab value="focus" icon={<Icon data={Target} size={16} />} counter={lists.focus.length}>
                    Фокус
                </Tab>
                <Tab value="backlog" icon={<Icon data={Tray} size={16} />} counter={lists.backlog.length}>
                    Бэклог
                </Tab>
                <Tab value="done" icon={<Icon data={CircleCheck} size={16} />}>
                    Выполненные
                </Tab>
                <Tab value="roadmap" icon={<Icon data={BarsUnaligned} size={16} />}>
                    Roadmap
                </Tab>
            </TabList>

            {tags.length > 0 && view !== 'roadmap' && (
                <TagFilter tags={sortedTags} value={activeFilter} onChange={setTagFilter} />
            )}

            {error && (
                <Alert theme="danger" message={error} onClose={() => setError(null)} className="mv-alert" />
            )}
            {notice && (
                <Alert theme="success" message={notice} onClose={() => setNotice(null)} className="mv-alert" />
            )}

            <main className="mv-main">
                {view === 'backlog' && (
                    <NewTaskButton onClick={() => openDraft('backlog')} disabled={!backend}>
                        Новая задача
                    </NewTaskButton>
                )}
                {view === 'focus' && (
                    <>
                        <Text variant="body-1" color="secondary" className="mv-hint">
                            Фокусные задачи висят здесь постоянно, пока вы их не закроете.
                        </Text>
                        <NewTaskButton onClick={() => openDraft('focus')} disabled={!backend}>
                            Новая фокусная задача
                        </NewTaskButton>
                    </>
                )}
                {view === 'today' && !emptyDay && (
                    <div className="mv-plan-bar">
                        <Text variant="body-1" color="secondary">
                            План на {fmtDate.format(new Date())}. Невыполненное завтра вернётся в бэклог.
                        </Text>
                        <Button view="action" size="m" onClick={() => switchView('backlog')} disabled={!backend}>
                            <Icon data={Plus} size={16} />
                            Добавить задачи
                        </Button>
                    </div>
                )}

                {view === 'roadmap' ? (
                    <RoadmapsView
                        roadmaps={roadmaps}
                        tasks={all}
                        mapId={mapId}
                        onOpenMap={(id) => switchView('roadmap', id)}
                        milestoneId={milestoneId}
                        onOpenMilestone={setMilestoneId}
                        canShare={Boolean(backend?.shareRoadmap)}
                        disabled={!backend}
                        onSave={(r) => backend && run(backend.saveRoadmap(r))}
                        onRemove={removeRoadmap}
                        onShare={(id) => backend?.shareRoadmap && run(backend.shareRoadmap(id))}
                        onUnshare={(id) => backend?.unshareRoadmap && run(backend.unshareRoadmap(id))}
                        onOpenTask={(id) => {
                            setMilestoneId(null);
                            setDraft(null);
                            setOpenId(id);
                        }}
                        onLinkTask={(id, m) => patch(id, {milestoneId: m})}
                        onToggleTask={(c) =>
                            patch(c.id, c.done ? {done: false, doneAt: null} : {done: true, doneAt: new Date().toISOString()})
                        }
                        undoable={undoable}
                    />
                ) : view === 'backlog' && tasks !== null ? (
                    <BacklogBoard
                        backlog={lists.backlog}
                        today={lists.today}
                        renderRow={(t) => row(t)}
                        onPlace={placeOnBoard}
                        emptyBacklog={filtering ? 'Нет задач с выбранными тегами.' : 'Бэклог пуст.'}
                    />                ) : tasks === null ? (
                    <div className="mv-loading">
                        <Loader size="m" />
                        <Text color="secondary">Загружаю задачи…</Text>
                    </div>
                ) : emptyDay ? (
                    <PlanHero
                        hasBacklog={lists.backlog.length > 0}
                        disabled={!backend}
                        onPlan={() => switchView('backlog')}
                    />
                ) : shown.length === 0 ? (
                    filtering ? (
                        <div className="mv-empty">
                            <Text color="secondary">Нет задач с выбранными тегами.</Text>
                        </div>
                    ) : (
                        <EmptyState view={view} hasBacklog={lists.backlog.length > 0} />
                    )
                ) : (
                    <SortableList
                        ids={shown.map((t) => t.id)}
                        disabled={view === 'done'}
                        onMove={(from, to) => view !== 'done' && reorder(view, shown, from, to)}
                    >
                        {shown.map((t) => row(t, view !== 'done'))}
                    </SortableList>
                )}
            </main>

            {/* на рабочем экране цитата сменяется реже и не зачитывается экранным диктором */}
            <Quotes every={20000} className="mv-quote_main" announce={false} />

            {backend?.kind === 'local' && (
                <Text variant="caption-2" color="secondary" className="mv-footnote">
                    Задачи сохраняются в этом браузере.
                </Text>
            )}

            <Dialog
                open={Boolean(cardTask)}
                onClose={closeCard}
                initialFocus={cardStored ? undefined : newTitleRef}
                hasCloseButton={false}
                maxWidth="m"
                fullWidth
                contentOverflow="auto"
                aria-label="Задача"
            >
                {cardTask && (
                    <TaskDetails
                        key={cardTask.id}
                        task={cardTask}
                        isNew={!cardStored}
                        titleRef={newTitleRef}
                        list={effectiveList(cardTask, today)}
                        tags={sortedTags}
                        tagMap={tagMap}
                        onPatch={(p) => (cardStored ? patch(cardTask.id, p) : patchDraft(p))}
                        onClose={closeCard}
                        onComplete={() => {
                            const id = cardTask.id;
                            closeCard();
                            window.setTimeout(() => {
                                const el = document.querySelector<HTMLElement>(`[data-check="${id}"]`);
                                complete(id, el);
                            }, 250);
                        }}
                        onReopen={() => reopen(cardTask.id)}
                        onPlan={() => planToday(cardTask.id)}
                        onBacklog={() => toBacklog(cardTask.id)}
                        onFocus={() => toFocus(cardTask.id)}
                        onDelete={() => {
                            removeTask(cardTask.id);
                            closeCard();
                        }}
                        onCreateTag={createTag}
                        focusTasks={focusTasks}
                        parent={parentOf(cardTask)}
                        subtasks={childrenOf(cardTask.id)}
                        linkable={all.filter(
                            (t) => !t.done && t.list !== 'focus' && t.id !== cardTask.id && !parentOf(t),
                        )}
                        onOpenTask={(id) => {
                            setDraft(null);
                            setOpenId(id);
                        }}
                        onLinkChild={(id, parentId) => patch(id, {parentId})}
                        onToggleChild={(c) =>
                            patch(c.id, c.done ? {done: false, doneAt: null} : {done: true, doneAt: new Date().toISOString()})
                        }
                        onAddChild={(title) => addChild(cardTask.id, title)}
                        milestones={milestones}
                        milestone={milestoneOf(cardTask)}
                        onOpenMilestone={(mapId, id) => {
                            closeCard();
                            switchView('roadmap', mapId);
                            setMilestoneId(id);
                        }}
                        parentProgress={(() => {
                            const p = parentOf(cardTask);
                            return p ? progressOf(p) : undefined;
                        })()}
                    />
                )}
            </Dialog>

            <TagsDialog
                open={tagsOpen}
                onClose={() => setTagsOpen(false)}
                tags={sortedTags}
                usage={(id) => all.filter((t) => t.tagIds.includes(id)).length}
                onSave={(t) => backend && run(backend.saveTag(t))}
                onRemove={removeTag}
            />

        </div>
    );
}

/* ---------------- части интерфейса ---------------- */

// мотивация на экране входа: в основном про то, как работают муравьи
const QUOTES = [
    'Муравей поднимает груз в 10–50 раз тяжелее себя. Ваша задача на сегодня точно легче.',
    'У муравьёв нет начальника: королева не раздаёт поручений. Каждый сам берёт то, что важнее сейчас.',
    'Пустынные муравьи считают шаги, чтобы найти дорогу домой. Считай и ты: каждая закрытая задача — шаг.',
    'Муравейник строится по одной хвоинке. День — по одной задаче.',
    'Муравьи живут на Земле больше 100 миллионов лет. Секрет — понемногу, но каждый день.',
    'Муравьи-листорезы за ночь могут обрить целое дерево. Маленькие куски складываются в большое дело.',
    'В колонии отдыхает чуть ли не половина муравьёв — это резерв на важный момент. Отдых тоже часть продуктивности.',
    'Муравьи-ткачи сшивают листья живой цепочкой. Сложное проще делать по частям.',
    'Огненные муравьи сцепляются в плот и переживают наводнение. Вместе выплывать проще.',
    'Тропа муравьёв появляется там, где прошёл первый. Начни — и дорога найдётся.',
    'Муравьи договариваются запахом, а не совещаниями. Меньше созвонов — больше дела.',
    'Муравей-разведчик не знает всего пути, он просто делает следующий шаг.',
    'Катаглифис выходит за едой в самый зной, когда хищники прячутся. Делай важное, пока никто не отвлекает.',
    'Муравьиная колония может пережить десятки лет, хотя каждый рабочий живёт месяцы. Системы сильнее усилий.',
    'Если муравьиная тропа перегружена, часть муравьёв просто ждёт у входа. Не бери больше, чем унесёшь сегодня.',
    'Муравьи убирают за собой: мусор — в отдельную камеру. Закрытые задачи тоже стоит убирать с глаз.',
];

function Quotes({every = 8000, className = '', announce = true}: {every?: number; className?: string; announce?: boolean}) {
    const [i, setI] = React.useState(() => Math.floor(Math.random() * QUOTES.length));
    const [shown, setShown] = React.useState(true);
    React.useEffect(() => {
        const id = window.setInterval(() => {
            setShown(false);
            window.setTimeout(() => {
                setI((x) => (x + 1) % QUOTES.length);
                setShown(true);
            }, 400);
        }, every);
        return () => window.clearInterval(id);
    }, [every]);
    return (
        <p className={`mv-quote${shown ? ' mv-quote_on' : ''} ${className}`} aria-live={announce ? 'polite' : 'off'}>
            {QUOTES[i]}
        </p>
    );
}

function GoogleLogo() {
    return (
        <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
    );
}

function LoginScreen({opts, onReady}: {opts: LoginOptions; onReady: (b: Backend) => void}) {
    const [mode, setMode] = React.useState<'login' | 'signup'>('login');
    const [email, setEmail] = React.useState(opts.defaultEmail ?? '');
    const [password, setPassword] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [err, setErr] = React.useState<string | null>(opts.loginError ? 'Не получилось войти через Google.' : null);
    const [info, setInfo] = React.useState<string | null>(null);
    const signup = mode === 'signup';
    const ready = password.length >= (signup ? 6 : 1) && (!opts.withEmail || /\S+@\S+\.\S+/.test(email.trim()));

    const google = () => {
        setErr(null);
        opts.google?.().catch(() => setErr('Не получилось войти через Google.'));
    };
    const explain = (x: unknown) => {
        const e = x as {status?: number; code?: string};
        if (e.status === 401) return opts.withEmail ? 'Неверная почта или пароль.' : 'Неверный пароль.';
        if (e.status === 409) return 'Такая почта уже зарегистрирована — войдите.';
        if (e.code === 'signup_disabled') return 'Регистрация сейчас закрыта.';
        if (e.code === 'weak_password') return 'Пароль слишком простой: нужно хотя бы 6 символов.';
        if (e.code === 'email_not_confirmed') return 'Сначала подтвердите почту по ссылке из письма.';
        return 'Сервер не ответил. Проверьте интернет и попробуйте ещё раз.';
    };
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        setErr(null);
        setInfo(null);
        try {
            if (signup && opts.signUp) {
                const b = await opts.signUp(email.trim(), password);
                if (b) return onReady(b);
                setInfo('Почти готово: мы отправили письмо на ' + email.trim() + '. Перейдите по ссылке из него.');
                setMode('login');
            } else {
                onReady(await opts.login(password, email.trim()));
                return;
            }
        } catch (x) {
            setErr(explain(x));
        }
        setBusy(false);
    };

    return (
        <div className="mv-login">
            <form className="mv-login__card" onSubmit={submit}>
                <div className="mv-login__brand">
                    <img src={logo} alt="" className="mv-login__logo" />
                    <Text variant="display-1" as="h1" className="mv-title">
                        Муравей
                    </Text>
                    <Text variant="body-2" color="secondary">
                        Таск трекер для продуктивных
                    </Text>
                </div>

                {opts.signUp && (
                    <TabList value={mode} onUpdate={(v) => setMode(v as typeof mode)} size="m" className="mv-login__tabs">
                        <Tab value="login">Вход</Tab>
                        <Tab value="signup">Регистрация</Tab>
                    </TabList>
                )}

                {opts.withEmail && (
                    <TextInput
                        id="mv-email"
                        type="email"
                        size="l"
                        autoFocus
                        autoComplete="username"
                        value={email}
                        onUpdate={setEmail}
                        placeholder="Почта"
                    />
                )}
                <TextInput
                    id="mv-password"
                    type="password"
                    size="l"
                    autoFocus={!opts.withEmail}
                    autoComplete={signup ? 'new-password' : 'current-password'}
                    value={password}
                    onUpdate={setPassword}
                    placeholder={signup ? 'Пароль, минимум 6 символов' : 'Пароль'}
                    validationState={err ? 'invalid' : undefined}
                    errorMessage={err ?? undefined}
                />
                {info && <Alert theme="info" message={info} />}
                <Button type="submit" view="action" size="l" width="max" loading={busy} disabled={!ready}>
                    {signup ? 'Зарегистрироваться' : 'Войти'}
                </Button>
                {opts.google && (
                    <>
                        <div className="mv-login__or">
                            <Text variant="caption-2" color="secondary">
                                или
                            </Text>
                        </div>
                        <Button view="outlined" size="l" width="max" onClick={google}>
                            <span className="mv-login__google">
                                <GoogleLogo />
                                {signup ? 'Регистрация через Google' : 'Войти через Google'}
                            </span>
                        </Button>
                    </>
                )}
            </form>
            <Quotes />
        </div>
    );
}

function NewTaskButton({onClick, disabled, children}: {onClick: () => void; disabled?: boolean; children: string}) {
    return (
        <div>
            <Button view="action" size="l" onClick={onClick} disabled={disabled}>
                <Icon data={Plus} size={16} />
                {children}
            </Button>
        </div>
    );
}

function TagInput({
    id,
    tags,
    tagMap,
    value,
    onUpdate,
    onCreateTag,
    onSubmit,
}: {
    id: string;
    tags: Tag[];
    tagMap: Map<string, Tag>;
    value: string[];
    onUpdate: (v: string[]) => void;
    onCreateTag: (name: string) => Tag;
    onSubmit?: () => void;
}) {
    const [text, setText] = React.useState('');
    const [active, setActive] = React.useState(0);
    const [focused, setFocused] = React.useState(false);
    const anchorRef = React.useRef<HTMLDivElement>(null);
    const q = text.trim().toLowerCase();
    const current = value.filter((x) => tagMap.has(x));
    const suggestions = q ? tags.filter((t) => !current.includes(t.id) && t.name.toLowerCase().includes(q)).slice(0, 8) : [];
    const open = focused && suggestions.length > 0;
    const activeIdx = Math.min(active, suggestions.length - 1);

    const add = (tagId: string) => {
        if (!current.includes(tagId)) onUpdate([...current, tagId]);
        setText('');
        setActive(0);
    };
    // Enter или запятая: подсказка, существующий тег с тем же именем или новый тег
    const commit = (raw: string) => {
        const name = raw.trim();
        if (!name) return setText('');
        const lower = name.toLowerCase();
        const same = tags.find((t) => t.name.toLowerCase() === lower);
        if (same) return add(same.id);
        if (open && raw === text) return add(suggestions[activeIdx].id);
        add(onCreateTag(name).id);
    };

    return (
        <div className="mv-taginput" ref={anchorRef}>
            {current.map((tid) => {
                const t = tagMap.get(tid)!;
                return (
                    <Label
                        key={tid}
                        theme={t.theme}
                        size="xs"
                        type="close"
                        closeButtonLabel={`Убрать тег ${t.name}`}
                        onCloseClick={() => onUpdate(current.filter((x) => x !== tid))}
                    >
                        {t.name}
                    </Label>
                );
            })}
            <input
                id={id}
                className="mv-taginput__field"
                value={text}
                placeholder="Добавить тег"
                autoComplete="off"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(e) => {
                    const v = e.target.value;
                    setActive(0);
                    if (v.endsWith(',')) commit(v.slice(0, -1));
                    else setText(v);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
                        e.preventDefault();
                        onSubmit();
                    } else if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                        commit(text);
                    } else if (e.key === 'ArrowDown' && open) {
                        e.preventDefault();
                        setActive((i) => (i + 1) % suggestions.length);
                    } else if (e.key === 'ArrowUp' && open) {
                        e.preventDefault();
                        setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
                    } else if (e.key === 'Escape' && text) {
                        e.preventDefault();
                        e.stopPropagation();
                        setText('');
                    } else if (e.key === 'Backspace' && !text && current.length) {
                        onUpdate(current.slice(0, -1));
                    }
                }}
            />
            <Popup
                open={open}
                anchorRef={anchorRef}
                placement="bottom-start"
                initialFocus={-1}
                returnFocus={false}
                disableEscapeKeyDown
                disableOutsideClick
            >
                <Menu size="m" className="mv-taginput__menu">
                    {suggestions.map((t, i) => (
                        <Menu.Item
                            key={t.id}
                            active={i === activeIdx}
                            onClick={() => add(t.id)}
                            extraProps={{onMouseDown: (e: React.MouseEvent) => e.preventDefault()}}
                        >
                            <Label theme={t.theme} size="xs">
                                {t.name}
                            </Label>
                        </Menu.Item>
                    ))}
                </Menu>
            </Popup>
        </div>
    );
}

const FILTER_KEY = 'muravey:tag-filter';

function TagFilter({tags, value, onChange}: {tags: Tag[]; value: string[]; onChange: (v: string[]) => void}) {
    const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    return (
        <div className="mv-filter" role="group" aria-label="Фильтр по тегам">
            <button
                type="button"
                className={`mv-filter__chip${value.length === 0 ? ' mv-filter__chip_on' : ''}`}
                aria-pressed={value.length === 0}
                onClick={() => onChange([])}
            >
                <Label theme="normal" size="xs">
                    Все
                </Label>
            </button>
            {tags.map((t) => {
                const on = value.includes(t.id);
                return (
                    <button
                        key={t.id}
                        type="button"
                        className={`mv-filter__chip${on ? ' mv-filter__chip_on' : ''}`}
                        aria-pressed={on}
                        onClick={() => toggle(t.id)}
                    >
                        <Label theme={t.theme} size="xs">
                            {t.name}
                        </Label>
                    </button>
                );
            })}
        </div>
    );
}

function PlanHero({hasBacklog, disabled, onPlan}: {hasBacklog: boolean; disabled: boolean; onPlan: () => void}) {
    // муравей бросает кофе и убегает к бэклогу, потом переключаем вкладку
    const [leaving, setLeaving] = React.useState(false);
    const go = () => {
        if (leaving) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return onPlan();
        setLeaving(true);
        window.setTimeout(onPlan, 1100);
    };
    return (
        <div className={`mv-hero${leaving ? ' mv-hero_leaving' : ''}`}>
            <div className="mv-hero__scene" aria-hidden="true">
                <img src={logo} alt="" className="mv-hero__ant" />
                {/* утренний кофе: планируют обычно с утра */}
                <svg className="mv-hero__coffee" viewBox="0 0 64 64">
                    <g className="mv-steam">
                        <path d="M24 20c-4-5 4-8 0-14" />
                        <path d="M32 20c-4-5 4-8 0-14" />
                        <path d="M40 20c-4-5 4-8 0-14" />
                    </g>
                    <path className="mv-mug__handle" d="M47 31h4a7 7 0 0 1 0 14h-5" />
                    <path className="mv-mug__body" d="M15 26h33v17a12 12 0 0 1-12 12h-9a12 12 0 0 1-12-12z" />
                    <ellipse className="mv-mug__coffee" cx="31.5" cy="27" rx="15" ry="3" />
                    <path className="mv-mug__band" d="M15 36h33v4H15z" />
                </svg>
            </div>
            <Text variant="header-1" as="h2" className="mv-hero__title">
                Сегодня — чистый лист
            </Text>
            <Text color="secondary" className="mv-hero__text">
                {hasBacklog
                    ? 'Выберите в бэклоге, за что взяться сегодня. Остальное подождёт.'
                    : 'Бэклог пока пуст: добавьте туда задачи и перетащите нужные в «Сегодня».'}
            </Text>
            <button
                type="button"
                className="mv-cta"
                disabled={disabled}
                onClick={go}
            >
                <Icon data={Sun} size={20} />
                Спланировать день
            </button>
        </div>
    );
}

function EmptyState({view, hasBacklog}: {view: Exclude<View, 'roadmap'>; hasBacklog: boolean}) {
    const text: Record<Exclude<View, 'roadmap'>, string> = {
        today: hasBacklog
            ? 'На сегодня пока ничего. Возьмите задачи из бэклога.'
            : 'На сегодня пока ничего. Добавьте задачи в бэклог, а потом запланируйте их сюда.',
        focus: 'Фокусных задач нет. Добавьте ту, что должна быть всегда перед глазами.',
        backlog: 'Бэклог пуст. Новые задачи появятся здесь.',
        done: 'Закрытых задач пока нет.',
    };
    return (
        <div className="mv-empty">
            <Text color="secondary">{text[view]}</Text>
        </div>
    );
}

export function TagLabels({ids, tagMap}: {ids: string[]; tagMap: Map<string, Tag>}) {
    const list = ids.map((id) => tagMap.get(id)).filter(Boolean) as Tag[];
    if (!list.length) return null;
    return (
        <>
            {list.map((t) => (
                <Label key={t.id} theme={t.theme} size="xs">
                    {t.name}
                </Label>
            ))}
        </>
    );
}

function CheckButton({
    id,
    done,
    completing,
    onClick,
}: {
    id: string;
    done: boolean;
    completing: boolean;
    onClick: (el: HTMLElement) => void;
}) {
    const ref = React.useRef<HTMLButtonElement>(null);
    return (
        <button
            ref={ref}
            type="button"
            data-check={id}
            className={`mv-check${done || completing ? ' mv-check_on' : ''}${completing ? ' mv-check_pop' : ''}`}
            aria-label={done ? 'Задача закрыта' : 'Закрыть задачу'}
            disabled={done || completing}
            onClick={(e) => {
                e.stopPropagation();
                if (ref.current) onClick(ref.current);
            }}
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 12.5l4 4 8-9" />
            </svg>
        </button>
    );
}

interface RowActions {
    onComplete: (el: HTMLElement) => void;
    onReopen: () => void;
    onPlan: () => void;
    onBacklog: () => void;
    onFocus: () => void;
    onDelete: () => void;
}

/** Тонкая полоска прогресса подзадач. */
function ProgressBar({done, total, wide}: {done: number; total: number; wide?: boolean}) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
        <span
            className={`mv-bar${wide ? ' mv-bar_wide' : ''}${done === total && total ? ' mv-bar_full' : ''}`}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <span className="mv-bar__fill" style={{width: pct + '%'}} />
        </span>
    );
}

/** Кнопка, открывающая список задач для выбора. */
function TaskPicker({
    id,
    label,
    icon,
    tasks,
    onPick,
}: {
    id: string;
    label: string;
    icon: typeof Link;
    tasks: Task[];
    onPick: (id: string) => void;
}) {
    return (
        <Select
            id={id}
            value={[]}
            filterable={tasks.length > 7}
            filterPlaceholder="Найти задачу"
            popupWidth={320}
            onUpdate={([v]) => v && onPick(v)}
            options={tasks.map((t) => ({value: t.id, content: t.title}))}
            renderControl={({ref, triggerProps}) => (
                <Button ref={ref as React.Ref<HTMLButtonElement>} {...triggerProps} view="outlined" size="m">
                    <Icon data={icon} size={16} />
                    {label}
                </Button>
            )}
        />
    );
}

function daysWord(n: number) {
    const a = n % 10;
    const b = n % 100;
    if (a === 1 && b !== 11) return 'день';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'дня';
    return 'дней';
}

/** Обезьяну покормили: она съедает банан и радуется */
function MonkeyFeast({onEnd}: {onEnd: () => void}) {
    React.useEffect(() => {
        const id = window.setTimeout(onEnd, 3000);
        return () => window.clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <div className="mv-feast" role="status" aria-live="polite">
            <div className="mv-feast__stage" aria-hidden="true">
                <span className="mv-feast__monkey">
                    <span className="mv-feast__face mv-feast__face_hungry">🐒</span>
                    <span className="mv-feast__face mv-feast__face_happy">🐵</span>
                </span>
                <span className="mv-feast__banana">🍌</span>
                <span className="mv-feast__heart mv-feast__heart_1">💛</span>
                <span className="mv-feast__heart mv-feast__heart_2">✨</span>
                <span className="mv-feast__heart mv-feast__heart_3">💛</span>
            </div>
            <div className="mv-feast__text">
                <span className="mv-feast__line mv-feast__line_eat">Ням-ням…</span>
                <span className="mv-feast__line mv-feast__line_happy">Обезьяна сыта и довольна!</span>
            </div>
        </div>
    );
}

function TaskRow({
    task,
    list,
    tagMap,
    completing,
    onOpen,
    sortable = false,
    parent,
    progress,
    onOpenParent,
    hungry = null,
    ...a
}: {
    task: Task;
    list: ListKind;
    tagMap: Map<string, Tag>;
    completing: boolean;
    onOpen: () => void;
    sortable?: boolean;
    /** фокусная задача, к которой относится эта */
    parent?: Task;
    /** у фокусной задачи: сколько подзадач закрыто */
    progress?: {done: number; total: number};
    onOpenParent?: (id: string) => void;
    /** сколько дней голодна обезьяна (null — сыта) */
    hungry?: number | null;
} & RowActions) {
    const drag = useSortableRow(task.id, sortable);
    const menu = [
        // в бэклоге для этого есть солнышко прямо на строке
        ...(list === 'focus' ? [{text: 'На сегодня', iconStart: <Icon data={Sun} size={16} />, action: a.onPlan}] : []),
        ...(list !== 'backlog'
            ? [{text: 'В бэклог', iconStart: <Icon data={Tray} size={16} />, action: a.onBacklog}]
            : []),
        ...(list !== 'focus'
            ? [{text: 'Сделать фокусной', iconStart: <Icon data={Target} size={16} />, action: a.onFocus}]
            : []),
        {
            text: 'Удалить',
            theme: 'danger' as const,
            iconStart: <Icon data={TrashBin} size={16} />,
            action: a.onDelete,
        },
    ];
    return (
        <li
            ref={drag.ref}
            style={drag.style}
            {...drag.props}
            className={`mv-row${completing ? ' mv-row_completing' : ''}${task.done ? ' mv-row_done' : ''}${
                sortable ? ' mv-row_sortable' : ''
            }${drag.isDragging ? ' mv-row_dragging' : ''}${hungry !== null ? ' mv-row_hungry' : ''}`}
            onClick={() => {
                if (!drag.consumeDrag()) onOpen();
            }}
        >
            {sortable && (
                <span className="mv-row__grip" aria-hidden="true">
                    <Icon data={Grip} size={14} />
                </span>
            )}
            <CheckButton id={task.id} done={task.done} completing={completing} onClick={a.onComplete} />
            <div className="mv-row__main">
                <span className="mv-row__title">{task.title}</span>
                <span className="mv-row__meta">
                    {hungry !== null && (
                        <span
                            className="mv-hungry"
                            title={
                                list === 'focus'
                                    ? `Подзадача стоит без движения ${hungry} ${daysWord(hungry)}. Покормите обезьяну: сделайте шаг по голодной подзадаче.`
                                    : `С задачей ничего не происходит ${hungry} ${daysWord(hungry)}. Покормите обезьяну: сделайте шаг по задаче — комментарий, правку описания, перенос.`
                            }
                        >
                            <span className="mv-hungry__monkey" aria-hidden="true">
                                🐒
                            </span>
                            Покорми меня
                        </span>
                    )}
                    {parent && (
                        <button
                            type="button"
                            className="mv-parent-chip"
                            title="Подзадача фокусной задачи — открыть её"
                            onClick={(e) => {
                                e.stopPropagation();
                                onOpenParent?.(parent.id);
                            }}
                        >
                            <Icon data={Target} size={12} />
                            <span>{parent.title}</span>
                        </button>
                    )}
                    {progress && (
                        <span
                            className={`mv-row__hint mv-progress${progress.done === progress.total ? ' mv-progress_full' : ''}`}
                            title={`Подзадачи: закрыто ${progress.done} из ${progress.total}`}
                        >
                            <ProgressBar done={progress.done} total={progress.total} />
                            {progress.done}/{progress.total}
                        </span>
                    )}
                    <TagLabels ids={task.tagIds} tagMap={tagMap} />
                    {task.description.trim() && (
                        <span className="mv-row__hint" title="Есть описание">
                            <Icon data={TextAlignLeft} size={14} />
                        </span>
                    )}
                    {task.comments.length > 0 && (
                        <span className="mv-row__hint" title="Комментарии">
                            <Icon data={CommentIcon} size={14} />
                            {task.comments.length}
                        </span>
                    )}
                    {task.done && task.doneAt && (
                        <span className="mv-row__hint">закрыта {fmtDateTime.format(new Date(task.doneAt))}</span>
                    )}
                </span>
            </div>
            <div className="mv-row__actions" onClick={(e) => e.stopPropagation()}>
                {task.done ? (
                    <Button view="flat" size="m" onClick={a.onReopen} title="Вернуть в работу">
                        <Icon data={ArrowUturnCcwLeft} size={16} />
                        Вернуть
                    </Button>
                ) : (
                    <>
                        {list === 'backlog' && (
                            <ActionTooltip title="Запланировать на сегодня">
                                <Button
                                    view="flat"
                                    size="m"
                                    onClick={a.onPlan}
                                    aria-label="Запланировать на сегодня"
                                >
                                    <Icon data={Sun} size={16} />
                                </Button>
                            </ActionTooltip>
                        )}
                        <DropdownMenu items={menu} size="m" />
                    </>
                )}
            </div>
        </li>
    );
}

function TaskDetails({
    task,
    isNew = false,
    titleRef,
    list,
    tags,
    tagMap,
    onPatch,
    onClose,
    onCreateTag,
    focusTasks,
    parent,
    subtasks,
    linkable,
    onOpenTask,
    onLinkChild,
    onToggleChild,
    onAddChild,
    parentProgress,
    milestones,
    milestone,
    onOpenMilestone,
    ...a
}: {
    task: Task;
    /** ещё не сохранённый черновик новой задачи */
    isNew?: boolean;
    titleRef?: React.RefObject<HTMLTextAreaElement>;
    list: ListKind;
    tags: Tag[];
    tagMap: Map<string, Tag>;
    /** null — правка принята, но писать пока нечего (у черновика нет названия) */
    onPatch: (p: Partial<Task>) => Promise<void> | null;
    onClose: () => void;
    onCreateTag: (name: string) => Tag;
    onComplete: () => void;
    /** открытые фокусные задачи — к ним можно привязать эту */
    focusTasks: Task[];
    parent?: Task;
    /** подзадачи, если это фокусная задача */
    subtasks: Task[];
    /** задачи, которые можно привязать к этой фокусной */
    linkable: Task[];
    onOpenTask: (id: string) => void;
    onLinkChild: (id: string, parentId: string | null) => void;
    onToggleChild: (t: Task) => void;
    onAddChild: (title: string) => void;
    parentProgress?: {done: number; total: number};
    /** все вехи всех дорожных карт — к любой можно привязать задачу */
    milestones: {map: Roadmap; m: Milestone}[];
    milestone?: {map: Roadmap; m: Milestone};
    onOpenMilestone: (mapId: string, id: string) => void;
} & Omit<RowActions, 'onComplete'>) {
    const [childTitle, setChildTitle] = React.useState('');
    const [title, setTitle] = React.useState(task.title);
    const [comment, setComment] = React.useState('');

    // правки сохраняются сами; в шапке показываем состояние последней записи
    type SaveState = {kind: 'idle'} | {kind: 'pending'} | {kind: 'saved'; at: Date} | {kind: 'failed'};
    const [saveState, setSaveState] = React.useState<SaveState>({kind: 'idle'});
    const seq = React.useRef(0);
    const save = React.useCallback(
        (p: Partial<Task>) => {
            const n = ++seq.current;
            const pr = onPatch(p);
            if (!pr) return setSaveState({kind: 'idle'});
            setSaveState({kind: 'pending'});
            pr.then(
                () => n === seq.current && setSaveState({kind: 'saved', at: new Date()}),
                () => n === seq.current && setSaveState({kind: 'failed'}),
            );
        },
        [onPatch],
    );
    const flushAndClose = () => {
        flushRef.current();
        onClose();
    };
    const submitKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            flushAndClose();
        }
    };

    // сохраняем текст после паузы и при уходе с поля
    const timer = React.useRef<number>();
    const pending = React.useRef<Partial<Task>>({});
    const flush = React.useCallback(() => {
        window.clearTimeout(timer.current);
        const p = pending.current;
        pending.current = {};
        if (Object.keys(p).length) save(p);
    }, [save]);
    const schedule = (p: Partial<Task>) => {
        if (task.title.trim() || p.title) setSaveState({kind: 'pending'});
        pending.current = {...pending.current, ...p};
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, 700);
    };
    const flushRef = React.useRef(flush);
    flushRef.current = flush;
    React.useEffect(() => () => flushRef.current(), []);

    const addComment = () => {
        const text = comment.trim();
        if (!text) return;
        flush();
        save({comments: [...task.comments, {id: uid(), text, at: new Date().toISOString()}]});
        setComment('');
    };

    const where = task.done ? 'Выполнена' : LIST_NAMES[list];

    return (
        <div className="mv-details mv-details_popup">
            <div className="mv-details__head">
                <Label theme={task.done ? 'success' : list === 'focus' ? 'utility' : 'normal'} size="s">
                    {isNew ? (list === 'focus' ? 'Новая фокусная задача' : 'Новая задача в бэклог') : where}
                </Label>
                <SaveStatus state={saveState} createdAt={task.createdAt} isNew={isNew} />
                <div className="mv-details__actions">
                    {!isNew && (
                        <>
                            {!task.done && list !== 'today' && (
                                <ActionTooltip title="На сегодня">
                                    <Button view="flat" size="m" onClick={a.onPlan} aria-label="На сегодня">
                                        <Icon data={Sun} size={16} />
                                    </Button>
                                </ActionTooltip>
                            )}
                            {!task.done && list !== 'backlog' && (
                                <ActionTooltip title="В бэклог">
                                    <Button view="flat" size="m" onClick={a.onBacklog} aria-label="В бэклог">
                                        <Icon data={Tray} size={16} />
                                    </Button>
                                </ActionTooltip>
                            )}
                            {!task.done && list !== 'focus' && (
                                <ActionTooltip title="Сделать фокусной">
                                    <Button view="flat" size="m" onClick={a.onFocus} aria-label="Сделать фокусной">
                                        <Icon data={Target} size={16} />
                                    </Button>
                                </ActionTooltip>
                            )}
                            <ActionTooltip title="Удалить">
                                <Button view="flat-danger" size="m" onClick={a.onDelete} aria-label="Удалить задачу">
                                    <Icon data={TrashBin} size={16} />
                                </Button>
                            </ActionTooltip>
                        </>
                    )}
                </div>
                <Button view="flat" size="m" onClick={flushAndClose} aria-label="Закрыть" className="mv-details__close">
                    <Icon data={Xmark} size={16} />
                </Button>
            </div>

            <div className="mv-details__titlerow">
                {!isNew && (
                    <button
                        type="button"
                        className={`mv-check${task.done ? ' mv-check_on' : ''}`}
                        aria-label={task.done ? 'Вернуть в работу' : 'Закрыть задачу'}
                        title={task.done ? 'Вернуть в работу' : 'Закрыть задачу'}
                        onClick={() => {
                            flush();
                            if (task.done) a.onReopen();
                            else a.onComplete();
                        }}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 12.5l4 4 8-9" />
                        </svg>
                    </button>
                )}
                <TextArea
                    id="mv-task-title"
                    controlRef={titleRef}
                    onKeyDown={submitKey}
                    view="clear"
                    size="xl"
                    minRows={1}
                    className="mv-details__title"
                    value={title}
                    onUpdate={(v) => {
                        setTitle(v);
                        if (v.trim()) schedule({title: v.trim()});
                    }}
                    onBlur={() => {
                        if (!title.trim()) setTitle(task.title);
                        flush();
                    }}
                    placeholder={isNew ? 'Название задачи' : 'Название'}
                />
            </div>

            <section className="mv-field">
                <Text variant="subheader-1">Описание</Text>
                <DescriptionEditor
                    value={task.description}
                    onChange={(v) => schedule({description: v})}
                    onSubmit={flushAndClose}
                    placeholder="Подробности, ссылки, критерии готовности"
                />
            </section>

            <section className="mv-field">
                <Text variant="subheader-1">Теги</Text>
                <TagInput
                    id="mv-task-tags"
                    tags={tags}
                    tagMap={tagMap}
                    value={task.tagIds}
                    onUpdate={(v) => save({tagIds: v})}
                    onCreateTag={onCreateTag}
                    onSubmit={flushAndClose}
                />
            </section>

            {list !== 'focus' && (focusTasks.length > 0 || parent) && (
                <section className="mv-field">
                    <Text variant="subheader-1">Фокусная задача</Text>
                    {parent ? (
                        <div className="mv-parent-card">
                            <button type="button" className="mv-parent-card__main" onClick={() => onOpenTask(parent.id)}>
                                <span className="mv-parent-card__icon">
                                    <Icon data={Target} size={16} />
                                </span>
                                <span className="mv-parent-card__text">
                                    <span className="mv-parent-card__title">{parent.title}</span>
                                    <Text variant="caption-2" color="secondary">
                                        {parentProgress
                                            ? `Подзадач закрыто: ${parentProgress.done} из ${parentProgress.total}`
                                            : 'Открыть фокусную задачу'}
                                    </Text>
                                </span>
                                {parentProgress && <ProgressBar done={parentProgress.done} total={parentProgress.total} />}
                            </button>
                            <ActionTooltip title="Отвязать от фокусной">
                                <Button view="flat-secondary" size="m" onClick={() => save({parentId: null})} aria-label="Отвязать от фокусной задачи">
                                    <Icon data={LinkSlash} size={16} />
                                </Button>
                            </ActionTooltip>
                        </div>
                    ) : (
                        <TaskPicker
                            id="mv-task-parent"
                            label="Привязать к фокусной задаче"
                            icon={Target}
                            tasks={focusTasks}
                            onPick={(id) => save({parentId: id})}
                        />
                    )}
                </section>
            )}

            {(milestones.length > 0 || milestone) && (
                <section className="mv-field">
                    <Text variant="subheader-1">Веха</Text>
                    {milestone ? (
                        <div className="mv-parent-card mv-parent-card_milestone">
                            <button
                                type="button"
                                className="mv-parent-card__main"
                                onClick={() => onOpenMilestone(milestone.map.id, milestone.m.id)}
                            >
                                <span className="mv-parent-card__icon">
                                    <Icon data={Flag} size={16} />
                                </span>
                                <span className="mv-parent-card__text">
                                    <span className="mv-parent-card__title">{milestone.m.title}</span>
                                    <Text variant="caption-2" color="secondary">
                                        {milestone.map.title} · {datesText(milestone.m)}
                                    </Text>
                                </span>
                            </button>
                            <ActionTooltip title="Отвязать от вехи">
                                <Button view="flat-secondary" size="m" onClick={() => save({milestoneId: null})} aria-label="Отвязать от вехи">
                                    <Icon data={LinkSlash} size={16} />
                                </Button>
                            </ActionTooltip>
                        </div>
                    ) : (
                        <div>
                            <Select
                                id="mv-task-milestone"
                                value={[]}
                                filterable={milestones.length > 7}
                                filterPlaceholder="Найти веху"
                                popupWidth={320}
                                onUpdate={([v]) => v && save({milestoneId: v})}
                                options={[...new Set(milestones.map((x) => x.map))].map((map) => ({
                                    label: map.title,
                                    options: milestones
                                        .filter((x) => x.map === map)
                                        .map((x) => ({value: x.m.id, content: x.m.title, text: x.m.title})),
                                }))}
                                renderControl={({ref, triggerProps}) => (
                                    <Button ref={ref as React.Ref<HTMLButtonElement>} {...triggerProps} view="outlined" size="m">
                                        <Icon data={Flag} size={16} />
                                        Привязать к вехе
                                    </Button>
                                )}
                            />
                        </div>
                    )}
                </section>
            )}

            {list === 'focus' && !isNew && (
                <section className="mv-field">
                    <div className="mv-subtasks__head">
                        <Text variant="subheader-1">Подзадачи</Text>
                        {subtasks.length > 0 && (
                            <Text variant="caption-2" color="secondary">
                                {subtasks.filter((x) => x.done).length} из {subtasks.length}
                            </Text>
                        )}
                    </div>
                    {subtasks.length > 0 ? (
                        <>
                            <ProgressBar done={subtasks.filter((x) => x.done).length} total={subtasks.length} wide />
                            <ul className="mv-subtasks">
                                {subtasks.map((c) => (
                                    <li key={c.id} className={`mv-subtask${c.done ? ' mv-subtask_done' : ''}`}>
                                        <button
                                            type="button"
                                            className={`mv-check mv-check_s${c.done ? ' mv-check_on' : ''}`}
                                            aria-label={c.done ? 'Вернуть в работу' : 'Закрыть подзадачу'}
                                            onClick={() => onToggleChild(c)}
                                        >
                                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                                <path d="M6 12.5l4 4 8-9" />
                                            </svg>
                                        </button>
                                        <button type="button" className="mv-subtask__title" onClick={() => onOpenTask(c.id)}>
                                            {c.title}
                                        </button>
                                        {!c.done && c.list === 'today' && (
                                            <span className="mv-subtask__where" title="Запланирована на сегодня">
                                                <Icon data={Sun} size={14} />
                                            </span>
                                        )}
                                        <ActionTooltip title="Отвязать">
                                            <Button
                                                view="flat-secondary"
                                                size="s"
                                                className="mv-subtask__unlink"
                                                onClick={() => onLinkChild(c.id, null)}
                                                aria-label={`Отвязать «${c.title}»`}
                                            >
                                                <Icon data={LinkSlash} size={14} />
                                            </Button>
                                        </ActionTooltip>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : (
                        <Text color="secondary" className="mv-subtasks__empty">
                            Разбейте фокусную задачу на шаги — подзадачи попадут в бэклог, а здесь будет виден прогресс.
                        </Text>
                    )}
                    <div className="mv-subtask-add">
                        <TextInput
                            id="mv-subtask-new"
                            size="m"
                            value={childTitle}
                            onUpdate={setChildTitle}
                            startContent={<Icon data={Plus} size={16} className="mv-subtask-add__plus" />}
                            placeholder="Новая подзадача"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && childTitle.trim()) {
                                    e.preventDefault();
                                    onAddChild(childTitle.trim());
                                    setChildTitle('');
                                }
                            }}
                        />
                        {linkable.length > 0 && (
                            <TaskPicker
                                id="mv-subtask-link"
                                label="Привязать"
                                icon={Link}
                                tasks={linkable}
                                onPick={(id) => onLinkChild(id, task.id)}
                            />
                        )}
                    </div>
                </section>
            )}

            {!isNew && (
                <section className="mv-field">
                    <Text variant="subheader-1">
                        Комментарии{task.comments.length ? ` · ${task.comments.length}` : ''}
                    </Text>
                    <TextArea
                        id="mv-task-comment"
                        size="m"
                        minRows={2}
                        value={comment}
                        onUpdate={setComment}
                        placeholder="Заметка для себя. Ctrl+Enter, чтобы добавить"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                addComment();
                            }
                        }}
                    />
                    {task.comments.length > 0 && (
                        <ol className="mv-comments">
                            {[...task.comments]
                                .sort((x, y) => y.at.localeCompare(x.at))
                                .map((c) => (
                                    <li key={c.id} className="mv-comment">
                                        <Text variant="caption-2" color="secondary" className="mv-comment__at">
                                            {fmtDateTime.format(new Date(c.at))}
                                        </Text>
                                        <Text variant="body-1" className="mv-comment__text">
                                            {c.text}
                                        </Text>
                                    </li>
                                ))}
                        </ol>
                    )}
                </section>
            )}
        </div>
    );
}

function SaveStatus({
    state,
    createdAt,
    isNew,
}: {
    state: {kind: 'idle'} | {kind: 'pending'} | {kind: 'saved'; at: Date} | {kind: 'failed'};
    createdAt: string;
    isNew: boolean;
}) {
    if (state.kind === 'pending') {
        return (
            <Text variant="caption-2" color="secondary" aria-live="polite">
                Сохраняю…
            </Text>
        );
    }
    if (state.kind === 'saved') {
        return (
            <Text variant="caption-2" color="secondary" className="mv-saved" aria-live="polite">
                <Icon data={CircleCheck} size={12} />
                Изменения сохранены в {fmtTime.format(state.at)}
            </Text>
        );
    }
    if (state.kind === 'failed') {
        return (
            <Text variant="caption-2" color="danger" aria-live="polite">
                Не сохранено
            </Text>
        );
    }
    return (
        <Text variant="caption-2" color="secondary">
            {isNew ? 'Сохранится, как только появится название' : `создана ${fmtDateTime.format(new Date(createdAt))}`}
        </Text>
    );
}

function ThemePicker({value, onChange, name}: {value: TagTheme; onChange: (t: TagTheme) => void; name: string}) {
    return (
        <div className="mv-swatches" role="radiogroup" aria-label="Цвет тега">
            {TAG_THEMES.map((th) => (
                <button
                    key={th}
                    type="button"
                    role="radio"
                    aria-checked={value === th}
                    title={THEME_NAMES[th]}
                    className={`mv-swatch${value === th ? ' mv-swatch_on' : ''}`}
                    onClick={() => onChange(th)}
                >
                    <Label theme={th} size="xs">
                        {name.trim() ? name.trim().slice(0, 1).toUpperCase() : 'А'}
                    </Label>
                </button>
            ))}
        </div>
    );
}

function TagsDialog({
    open,
    onClose,
    tags,
    usage,
    onSave,
    onRemove,
}: {
    open: boolean;
    onClose: () => void;
    tags: Tag[];
    usage: (id: string) => number;
    onSave: (t: Tag) => void;
    onRemove: (id: string) => void;
}) {
    const [name, setName] = React.useState('');
    const [theme, setTheme] = React.useState<TagTheme>('info');
    const create = (e?: React.FormEvent) => {
        e?.preventDefault();
        const n = name.trim();
        if (!n) return;
        onSave({id: uid(), name: n, theme, createdAt: new Date().toISOString()});
        setName('');
    };
    return (
        <Dialog open={open} onClose={onClose} maxWidth="m" fullWidth contentOverflow="auto">
            <Dialog.Header caption="Теги" />
            <Dialog.Body>
                <div className="mv-tags">
                    <form className="mv-tag-new" onSubmit={create}>
                        <TextInput
                            id="mv-tag-new-name"
                            size="m"
                            value={name}
                            onUpdate={setName}
                            placeholder="Новый тег, например проект"
                        />
                        <ThemePicker value={theme} onChange={setTheme} name={name} />
                        <Button type="submit" view="action" size="m" disabled={!name.trim()}>
                            <Icon data={Plus} size={16} />
                            Создать
                        </Button>
                    </form>
                    {tags.length === 0 ? (
                        <Text color="secondary">Тегов пока нет.</Text>
                    ) : (
                        <ul className="mv-tag-list">
                            {tags.map((t) => (
                                <TagEditRow
                                    key={t.id}
                                    tag={t}
                                    count={usage(t.id)}
                                    onSave={onSave}
                                    onRemove={() => onRemove(t.id)}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </Dialog.Body>
        </Dialog>
    );
}

function TagEditRow({
    tag,
    count,
    onSave,
    onRemove,
}: {
    tag: Tag;
    count: number;
    onSave: (t: Tag) => void;
    onRemove: () => void;
}) {
    const [name, setName] = React.useState(tag.name);
    React.useEffect(() => setName(tag.name), [tag.name]);
    const commit = () => {
        const n = name.trim();
        if (!n) return setName(tag.name);
        if (n !== tag.name) onSave({...tag, name: n});
    };
    return (
        <li className="mv-tag-row">
            <div className="mv-tag-row__name">
                <TextInput
                    id={`mv-tag-${tag.id}`}
                    size="m"
                    value={name}
                    onUpdate={setName}
                    onBlur={commit}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <Text variant="caption-2" color="secondary" className="mv-tag-row__count">
                    {count ? `задач: ${count}` : 'не используется'}
                </Text>
            </div>
            <ThemePicker value={tag.theme} onChange={(th) => onSave({...tag, theme: th})} name={name} />
            <Button view="flat" size="m" onClick={onRemove} aria-label={`Удалить тег ${tag.name}`}>
                <Icon data={TrashBin} size={16} />
            </Button>
        </li>
    );
}
