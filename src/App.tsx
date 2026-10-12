import React from 'react';
import {
    Alert,
    Button,
    Dialog,
    Drawer,
    DropdownMenu,
    Icon,
    Label,
    Loader,
    Select,
    Tab,
    TabList,
    Text,
    TextArea,
    TextInput,
} from '@gravity-ui/uikit';
import {
    ArrowUturnCcwLeft,
    CircleCheck,
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

import {PlanBoard} from './PlanBoard';
import type {Backend} from './store';
import {pickBackend} from './store';
import {burst} from './confetti';
import {TAG_THEMES, dayKey, effectiveList, uid} from './types';
import type {ListKind, Tag, TagTheme, Task} from './types';

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
    const [draftList, setDraftList] = React.useState<'backlog' | 'focus' | null>(null);
    const newTitleRef = React.useRef<HTMLTextAreaElement>(null);
    const [tagsOpen, setTagsOpen] = React.useState(false);
    const [planning, setPlanning] = React.useState(false);
    const [completing, setCompleting] = React.useState<Set<string>>(new Set());
    const today = useToday();

    const tasksRef = React.useRef<Task[]>([]);
    tasksRef.current = tasks ?? [];

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
        (id: string, p: Partial<Task>) => {
            const t = tasksRef.current.find((x) => x.id === id);
            if (t && backend) run(backend.saveTask({...t, ...p}));
        },
        [backend, run],
    );

    const addTask = (d: Draft) => {
        if (!backend) return;
        const t: Task = {
            id: uid(),
            title: d.title,
            description: d.description,
            list: d.list,
            plannedFor: null,
            plannedAt: null,
            tagIds: d.tagIds,
            comments: [],
            done: false,
            doneAt: null,
            createdAt: new Date().toISOString(),
        };
        run(backend.saveTask(t));
    };

    const planToday = (id: string) =>
        patch(id, {list: 'today', plannedFor: today, plannedAt: new Date().toISOString()});
    const toBacklog = (id: string) => patch(id, {list: 'backlog', plannedFor: null, plannedAt: null});
    const toFocus = (id: string) => patch(id, {list: 'focus', plannedFor: null, plannedAt: null});

    const complete = (id: string, from?: HTMLElement | null) => {
        if (from) {
            const r = from.getBoundingClientRect();
            burst(r.left + r.width / 2, r.top + r.height / 2);
        } else {
            burst(window.innerWidth / 2, window.innerHeight / 3);
        }
        setCompleting((s) => new Set(s).add(id));
        window.setTimeout(() => {
            patch(id, {done: true, doneAt: new Date().toISOString()});
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

    const removeTask = (id: string) => {
        if (!backend) return;
        if (openId === id) setOpenId(null);
        run(backend.removeTask(id));
    };

    const removeTag = (tagId: string) => {
        if (!backend) return;
        for (const t of tasksRef.current) {
            if (t.tagIds.includes(tagId)) {
                run(backend.saveTask({...t, tagIds: t.tagIds.filter((x) => x !== tagId)}));
            }
        }
        run(backend.removeTag(tagId));
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
    const open = all.filter((t) => !t.done);
    const byList = (l: ListKind) => open.filter((t) => effectiveList(t, today) === l);
    const lists = {
        today: byList('today').sort((a, b) => (a.plannedAt ?? '').localeCompare(b.plannedAt ?? '')),
        focus: byList('focus').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        backlog: byList('backlog').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        done: all.filter((t) => t.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    };
    const shown = lists[view];
    const tagMap = new Map(tags.map((t) => [t.id, t]));
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const openTask = all.find((t) => t.id === openId) ?? null;
    const doneToday = all.filter((t) => t.done && t.doneAt && dayKey(new Date(t.doneAt)) === today).length;

    if (login) return <LoginScreen onLogin={login} />;

    return (
        <div className={`mv-app${view === 'today' && planning ? ' mv-app_wide' : ''}`}>
            <header className="mv-header">
                <div className="mv-brand">
                    <AntMark />
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
                <Button view="outlined" size="m" onClick={() => setTagsOpen(true)}>
                    <Icon data={TagIcon} size={16} />
                    Теги
                </Button>
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

            {error && (
                <Alert theme="danger" message={error} onClose={() => setError(null)} className="mv-alert" />
            )}

            <main className="mv-main">
                {view === 'backlog' && (
                    <NewTaskButton onClick={() => setDraftList('backlog')} disabled={!backend}>
                        Новая задача
                    </NewTaskButton>
                )}
                {view === 'focus' && (
                    <>
                        <Text variant="body-1" color="secondary" className="mv-hint">
                            Фокусные задачи висят здесь постоянно, пока вы их не закроете.
                        </Text>
                        <NewTaskButton onClick={() => setDraftList('focus')} disabled={!backend}>
                            Новая фокусная задача
                        </NewTaskButton>
                    </>
                )}
                {view === 'today' && (
                    <div className="mv-plan-bar">
                        <Text variant="body-1" color="secondary">
                            {planning
                                ? 'Перетащите задачи из бэклога в «Сегодня». Лишнее можно утащить обратно.'
                                : `План на ${fmtDate.format(new Date())}. Невыполненное завтра вернётся в бэклог.`}
                        </Text>
                        {planning ? (
                            <Button view="action" size="m" onClick={() => setPlanning(false)}>
                                Готово
                            </Button>
                        ) : (
                            <Button view="action" size="m" onClick={() => setPlanning(true)} disabled={!backend}>
                                <Icon data={Tray} size={16} />
                                Спланировать день
                            </Button>
                        )}
                    </div>
                )}

                {view === 'today' && planning && tasks !== null ? (
                    <PlanBoard
                        backlog={lists.backlog}
                        today={lists.today}
                        tagMap={tagMap}
                        onPlan={planToday}
                        onUnplan={toBacklog}
                    />
                ) : tasks === null ? (
                    <div className="mv-loading">
                        <Loader size="m" />
                        <Text color="secondary">Загружаю задачи…</Text>
                    </div>
                ) : shown.length === 0 ? (
                    <EmptyState view={view} hasBacklog={lists.backlog.length > 0} />
                ) : (
                    <ul className="mv-list">
                        {shown.map((t) => (
                            <TaskRow
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
                        ))}
                    </ul>
                )}
            </main>

            {backend?.kind === 'local' && (
                <Text variant="caption-2" color="secondary" className="mv-footnote">
                    Задачи сохраняются в этом браузере.
                </Text>
            )}

            <Drawer
                open={Boolean(draftList)}
                onOpenChange={(o) => !o && setDraftList(null)}
                disableOutsideClick
                initialFocus={newTitleRef}
                placement="right"
                size={Math.min(560, window.innerWidth)}
                contentOverflow="auto"
                aria-label="Новая задача"
            >
                {draftList && (
                    <NewTaskDetails
                        list={draftList}
                        titleRef={newTitleRef}
                        tags={sortedTags}
                        tagMap={tagMap}
                        onCreate={(d) => {
                            addTask(d);
                            setDraftList(null);
                        }}
                        onCancel={() => setDraftList(null)}
                        onManageTags={() => setTagsOpen(true)}
                    />
                )}
            </Drawer>

            <Drawer
                open={Boolean(openTask)}
                onOpenChange={(o) => !o && setOpenId(null)}
                placement="right"
                size={Math.min(560, window.innerWidth)}
                contentOverflow="auto"
                aria-label="Задача"
            >
                {openTask && (
                    <TaskDetails
                        key={openTask.id}
                        task={openTask}
                        list={effectiveList(openTask, today)}
                        tags={sortedTags}
                        tagMap={tagMap}
                        onPatch={(p) => patch(openTask.id, p)}
                        onClose={() => setOpenId(null)}
                        onComplete={() => {
                            const id = openTask.id;
                            setOpenId(null);
                            window.setTimeout(() => {
                                const el = document.querySelector<HTMLElement>(`[data-check="${id}"]`);
                                complete(id, el);
                            }, 250);
                        }}
                        onReopen={() => reopen(openTask.id)}
                        onPlan={() => planToday(openTask.id)}
                        onBacklog={() => toBacklog(openTask.id)}
                        onFocus={() => toFocus(openTask.id)}
                        onDelete={() => removeTask(openTask.id)}
                        onManageTags={() => setTagsOpen(true)}
                    />
                )}
            </Drawer>

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
                    <AntMark />
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

function AntMark() {
    return (
        <svg className="mv-mark" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="12" cy="20" r="5" />
            <circle cx="21" cy="20" r="4" />
            <ellipse cx="31" cy="20" rx="6" ry="5" />
            <path d="M8 16 4 9M9 16l1-8M21 16l-3-6M21 24l-3 6M24 17l4-6M24 23l4 6M31 15l2-6M31 25l2 6" />
        </svg>
    );
}

interface Draft {
    title: string;
    description: string;
    tagIds: string[];
    list: 'backlog' | 'focus';
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

function TagSelect({
    id,
    tags,
    tagMap,
    value,
    onUpdate,
    onManageTags,
}: {
    id: string;
    tags: Tag[];
    tagMap: Map<string, Tag>;
    value: string[];
    onUpdate: (v: string[]) => void;
    onManageTags: () => void;
}) {
    if (tags.length === 0) {
        return (
            <div className="mv-inline">
                <Text color="secondary">Тегов пока нет.</Text>
                <Button view="flat-action" size="s" onClick={onManageTags}>
                    Создать тег
                </Button>
            </div>
        );
    }
    return (
        <Select
            id={id}
            multiple
            filterable={tags.length > 7}
            width="max"
            size="m"
            placeholder="Без тегов"
            value={value.filter((x) => tagMap.has(x))}
            onUpdate={onUpdate}
            options={tags.map((t) => ({value: t.id, content: t.name, data: t}))}
            renderOption={(o) => (
                <Label theme={(o.data as Tag).theme} size="xs">
                    {(o.data as Tag).name}
                </Label>
            )}
            renderSelectedOption={(o) => (
                <Label key={o.value} theme={(o.data as Tag).theme} size="xs" className="mv-sel-tag">
                    {(o.data as Tag).name}
                </Label>
            )}
        />
    );
}

function NewTaskDetails({
    list,
    titleRef,
    tags,
    tagMap,
    onCreate,
    onCancel,
    onManageTags,
}: {
    list: 'backlog' | 'focus';
    titleRef: React.RefObject<HTMLTextAreaElement>;
    tags: Tag[];
    tagMap: Map<string, Tag>;
    onCreate: (d: Draft) => void;
    onCancel: () => void;
    onManageTags: () => void;
}) {
    const [title, setTitle] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [tagIds, setTagIds] = React.useState<string[]>([]);
    const ready = title.trim().length > 0;
    const create = () => {
        if (ready) onCreate({title: title.trim(), description, tagIds, list});
    };
    const ctrlEnter = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            create();
        }
    };
    return (
        <div className="mv-details">
            <div className="mv-details__head">
                <Label theme={list === 'focus' ? 'utility' : 'normal'} size="s">
                    {list === 'focus' ? 'Новая фокусная задача' : 'Новая задача в бэклог'}
                </Label>
                <Button view="flat" size="m" onClick={onCancel} aria-label="Закрыть панель" className="mv-details__x">
                    <Icon data={Xmark} size={16} />
                </Button>
            </div>

            <TextArea
                id="mv-new-title"
                view="clear"
                size="xl"
                minRows={1}
                controlRef={titleRef}
                className="mv-details__title"
                value={title}
                onUpdate={setTitle}
                onKeyDown={ctrlEnter}
                placeholder="Название задачи"
            />

            <section className="mv-field">
                <Text variant="subheader-1">Теги</Text>
                <TagSelect
                    id="mv-new-tags"
                    tags={tags}
                    tagMap={tagMap}
                    value={tagIds}
                    onUpdate={setTagIds}
                    onManageTags={onManageTags}
                />
            </section>

            <section className="mv-field">
                <Text variant="subheader-1">Описание</Text>
                <TextArea
                    id="mv-new-desc"
                    size="l"
                    minRows={5}
                    value={description}
                    onUpdate={setDescription}
                    onKeyDown={ctrlEnter}
                    placeholder="Подробности, ссылки, критерии готовности"
                />
            </section>

            <div className="mv-details__foot">
                <Button view="action" size="l" onClick={create} disabled={!ready}>
                    <Icon data={Plus} size={16} />
                    Создать задачу
                </Button>
                <Button view="flat" size="l" onClick={onCancel}>
                    Отмена
                </Button>
                <span className="mv-spacer" />
                <Text variant="caption-2" color="secondary">
                    Ctrl+Enter создаёт задачу
                </Text>
            </div>
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
    ...a
}: {
    task: Task;
    list: ListKind;
    tagMap: Map<string, Tag>;
    completing: boolean;
    onOpen: () => void;
} & RowActions) {
    const [confirmDelete, setConfirmDelete] = React.useState(false);
    const menu = [
        ...(list !== 'today' ? [{text: 'На сегодня', iconStart: <Icon data={Sun} size={16} />, action: a.onPlan}] : []),
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
            action: () => setConfirmDelete(true),
        },
    ];
    return (
        <li
            className={`mv-row${completing ? ' mv-row_completing' : ''}${task.done ? ' mv-row_done' : ''}`}
            onClick={onOpen}
        >
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
                            <Button view="flat" size="m" onClick={a.onPlan} title="Запланировать на сегодня">
                                <Icon data={Sun} size={16} />
                                <span className="mv-hide-narrow">На сегодня</span>
                            </Button>
                        )}
                        <DropdownMenu items={menu} size="m" />
                    </>
                )}
            </div>
            <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} size="s">
                <Dialog.Header caption="Удалить задачу?" />
                <Dialog.Body>
                    «{task.title}» удалится вместе с описанием и комментариями. Отменить это нельзя.
                </Dialog.Body>
                <Dialog.Footer
                    textButtonApply="Удалить"
                    textButtonCancel="Отмена"
                    propsButtonApply={{view: 'outlined-danger'}}
                    onClickButtonApply={() => {
                        setConfirmDelete(false);
                        a.onDelete();
                    }}
                    onClickButtonCancel={() => setConfirmDelete(false)}
                />
            </Dialog>
        </li>
    );
}

function TaskDetails({
    task,
    list,
    tags,
    tagMap,
    onPatch,
    onClose,
    onManageTags,
    ...a
}: {
    task: Task;
    list: ListKind;
    tags: Tag[];
    tagMap: Map<string, Tag>;
    onPatch: (p: Partial<Task>) => void;
    onClose: () => void;
    onManageTags: () => void;
    onComplete: () => void;
} & Omit<RowActions, 'onComplete'>) {
    const [title, setTitle] = React.useState(task.title);
    const [desc, setDesc] = React.useState(task.description);
    const [comment, setComment] = React.useState('');
    const [confirmDelete, setConfirmDelete] = React.useState(false);

    // сохраняем текст после паузы и при уходе с поля
    const timer = React.useRef<number>();
    const pending = React.useRef<Partial<Task>>({});
    const flush = React.useCallback(() => {
        window.clearTimeout(timer.current);
        const p = pending.current;
        pending.current = {};
        if (Object.keys(p).length) onPatch(p);
    }, [onPatch]);
    const schedule = (p: Partial<Task>) => {
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
        onPatch({comments: [...task.comments, {id: uid(), text, at: new Date().toISOString()}]});
        setComment('');
    };

    const where = task.done ? 'Выполнена' : LIST_NAMES[list];

    return (
        <div className="mv-details">
            <div className="mv-details__head">
                <Label theme={task.done ? 'success' : list === 'focus' ? 'utility' : 'normal'} size="s">
                    {where}
                </Label>
                <Text variant="caption-2" color="secondary">
                    создана {fmtDateTime.format(new Date(task.createdAt))}
                </Text>
                <Button view="flat" size="m" onClick={onClose} aria-label="Закрыть панель" className="mv-details__x">
                    <Icon data={Xmark} size={16} />
                </Button>
            </div>

            <TextArea
                id="mv-task-title"
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
                placeholder="Название"
            />

            <section className="mv-field">
                <Text variant="subheader-1">Теги</Text>
                <TagSelect
                    id="mv-task-tags"
                    tags={tags}
                    tagMap={tagMap}
                    value={task.tagIds}
                    onUpdate={(v) => onPatch({tagIds: v})}
                    onManageTags={onManageTags}
                />
            </section>

            <section className="mv-field">
                <Text variant="subheader-1">Описание</Text>
                <TextArea
                    id="mv-task-desc"
                    size="l"
                    minRows={3}
                    value={desc}
                    onUpdate={(v) => {
                        setDesc(v);
                        schedule({description: v});
                    }}
                    onBlur={flush}
                    placeholder="Подробности, ссылки, критерии готовности"
                />
            </section>

            <section className="mv-field">
                <Text variant="subheader-1">Комментарии{task.comments.length ? ` · ${task.comments.length}` : ''}</Text>
                {task.comments.length > 0 && (
                    <ol className="mv-comments">
                        {task.comments.map((c) => (
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
                <div>
                    <Button view="normal" size="m" onClick={addComment} disabled={!comment.trim()}>
                        <Icon data={CommentIcon} size={16} />
                        Добавить комментарий
                    </Button>
                </div>
            </section>

            <div className="mv-details__foot">
                {task.done ? (
                    <Button view="action" size="l" onClick={a.onReopen}>
                        <Icon data={ArrowUturnCcwLeft} size={16} />
                        Вернуть в работу
                    </Button>
                ) : (
                    <Button
                        view="action"
                        size="l"
                        onClick={() => {
                            flush();
                            a.onComplete();
                        }}
                    >
                        <Icon data={CircleCheck} size={16} />
                        Закрыть задачу
                    </Button>
                )}
                {!task.done && list !== 'today' && (
                    <Button view="outlined" size="l" onClick={a.onPlan}>
                        <Icon data={Sun} size={16} />
                        На сегодня
                    </Button>
                )}
                {!task.done && list !== 'backlog' && (
                    <Button view="outlined" size="l" onClick={a.onBacklog}>
                        <Icon data={Tray} size={16} />В бэклог
                    </Button>
                )}
                {!task.done && list !== 'focus' && (
                    <Button view="outlined" size="l" onClick={a.onFocus}>
                        <Icon data={Target} size={16} />
                        Фокусная
                    </Button>
                )}
                <span className="mv-spacer" />
                {confirmDelete ? (
                    <span className="mv-inline">
                        <Text>Удалить?</Text>
                        <Button view="outlined-danger" size="l" onClick={a.onDelete}>
                            Да
                        </Button>
                        <Button view="flat" size="l" onClick={() => setConfirmDelete(false)}>
                            Нет
                        </Button>
                    </span>
                ) : (
                    <Button view="flat-danger" size="l" onClick={() => setConfirmDelete(true)}>
                        <Icon data={TrashBin} size={16} />
                        Удалить
                    </Button>
                )}
            </div>
        </div>
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
    const [confirm, setConfirm] = React.useState(false);
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
            {confirm ? (
                <span className="mv-inline">
                    <Button view="outlined-danger" size="m" onClick={onRemove}>
                        Удалить
                    </Button>
                    <Button view="flat" size="m" onClick={() => setConfirm(false)}>
                        Отмена
                    </Button>
                </span>
            ) : (
                <Button view="flat" size="m" onClick={() => setConfirm(true)} aria-label={`Удалить тег ${tag.name}`}>
                    <Icon data={TrashBin} size={16} />
                </Button>
            )}
        </li>
    );
}
