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
    useToaster,
    Tab,
    TabList,
    Text,
    TextArea,
    TextInput,
} from '@gravity-ui/uikit';
import {
    ArrowUturnCcwLeft,
    CircleCheck,
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
import {burst} from './confetti';
import {TAG_THEMES, dayKey, effectiveList, sortKey, uid} from './types';
import type {ListKind, Tag, TagTheme, Task} from './types';
import {BackupMenu} from './Backup';
import {BacklogBoard} from './BacklogBoard';
import {DescriptionEditor} from './DescriptionEditor';
import {SortableList, useSortableRow} from './SortableList';
import logo from './assets/logo.png';

type View = ListKind | 'done';

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
    const [login, setLogin] = React.useState<((password: string) => Promise<void>) | null>(null);
    const [tasks, setTasks] = React.useState<Task[] | null>(null);
    const [tags, setTags] = React.useState<Tag[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const [view, setView] = React.useState<View>(() => {
        const h = window.location.hash.slice(1);
        return (['today', 'focus', 'backlog', 'done'] as View[]).includes(h as View) ? (h as View) : 'today';
    });
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
            unsub = b.subscribe(setTasks, setTags, setError);
        };
        pickBackend().then((r) => {
            if (!alive) return;
            if ('backend' in r) connect(r.backend);
            else setLogin(() => (password: string) => r.login(password).then(connect));
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
            const pr = backend.saveTask({...t, ...p});
            run(pr);
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
    const toFocus = (id: string) => patch(id, {list: 'focus', plannedFor: null, plannedAt: null, order: null});

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

    const switchView = (v: string) => {
        setView(v as View);
        try {
            history.replaceState(null, '', '#' + v);
        } catch {
            /* без адресной строки */
        }
    };

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
    const shown = lists[view];
    // на сегодня пусто (и фильтр ничего не прячет) — показываем большой экран «Спланировать день»
    const emptyDay = view === 'today' && tasks !== null && lists.today.length === 0 && !filtering;
    const tagMap = new Map(tags.map((t) => [t.id, t]));
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const cardId = openId ?? draft?.id ?? null;
    const cardStored = all.find((t) => t.id === cardId) ?? null;
    const cardTask = cardStored ?? (draft && draft.id === cardId ? draft : null);
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
        />
    );

    if (login) return <LoginScreen onLogin={login} />;

    return (
        <div className={`mv-app${view === 'backlog' ? ' mv-app_wide' : ''}`}>
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
                        onResult={(r) => (r.ok ? setNotice(r.message) : setError(r.message))}
                    />
                </div>
            </header>

            <TabList value={view} onUpdate={switchView} size="l" contentOverflow="scroll" className="mv-tabs">
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
            </TabList>

            {tags.length > 0 && (
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

                {view === 'backlog' && tasks !== null ? (
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

function LoginScreen({onLogin}: {onLogin: (password: string) => Promise<void>}) {
    const [password, setPassword] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [err, setErr] = React.useState<string | null>(null);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password) return;
        setBusy(true);
        setErr(null);
        try {
            await onLogin(password);
        } catch (x) {
            setErr(
                (x as {status?: number}).status === 401
                    ? 'Неверный пароль.'
                    : 'Сервер не ответил. Проверьте интернет и попробуйте ещё раз.',
            );
            setBusy(false);
        }
    };
    return (
        <div className="mv-login">
            <form className="mv-login__card" onSubmit={submit}>
                <div className="mv-brand">
                    <img src={logo} alt="" className="mv-mark" />
                    <Text variant="header-1" as="h1" className="mv-title">
                        Муравей
                    </Text>
                </div>
                <TextInput
                    id="mv-password"
                    type="password"
                    size="l"
                    autoFocus
                    value={password}
                    onUpdate={setPassword}
                    placeholder="Пароль"
                    validationState={err ? 'invalid' : undefined}
                    errorMessage={err ?? undefined}
                />
                <Button type="submit" view="action" size="l" width="max" loading={busy} disabled={!password}>
                    Войти
                </Button>
            </form>
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

function EmptyState({view, hasBacklog}: {view: View; hasBacklog: boolean}) {
    const text: Record<View, string> = {
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

function TaskRow({
    task,
    list,
    tagMap,
    completing,
    onOpen,
    sortable = false,
    ...a
}: {
    task: Task;
    list: ListKind;
    tagMap: Map<string, Tag>;
    completing: boolean;
    onOpen: () => void;
    sortable?: boolean;
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
            }${drag.isDragging ? ' mv-row_dragging' : ''}`}
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
} & Omit<RowActions, 'onComplete'>) {
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
