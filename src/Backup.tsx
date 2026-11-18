import React from 'react';
import {Button, Dialog, DropdownMenu, Icon, Loader} from '@gravity-ui/uikit';
import {ArrowDownToLine, ArrowRightFromSquare, ArrowUpFromLine, ArrowUturnCcwLeft, Ellipsis} from '@gravity-ui/icons';

import type {Backend, BackupSnapshot} from './store';
import type {Product, Roadmap, StakeholderMap, Tag, Task} from './types';
import {dayKey} from './types';

interface Parsed {
    tasks: Task[];
    tags: Tag[];
    roadmaps: Roadmap[];
    stakeholders: StakeholderMap[];
    products: Product[];
    newTasks: number;
    newTags: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const fmtBackup = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

function parseBackup(text: string): {
    tasks: Task[];
    tags: Tag[];
    roadmaps: Roadmap[];
    stakeholders: StakeholderMap[];
    products: Product[];
} {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('Файл не похож на резервную копию: это не JSON.');
    }
    if (!isObj(data) || !Array.isArray(data.tasks) || !Array.isArray(data.tags)) {
        throw new Error('В файле нет списков задач и тегов. Нужна копия, скачанная из Муравья.');
    }
    const tasks = data.tasks.filter(
        (t): t is Partial<Task> & Pick<Task, 'id' | 'title'> =>
            isObj(t) && typeof t.id === 'string' && typeof t.title === 'string',
    );
    const tags = data.tags.filter((t): t is Tag => isObj(t) && typeof t.id === 'string' && typeof t.name === 'string');
    // в копиях до дорожных карт их просто нет
    const rawMaps = Array.isArray(data.roadmaps) ? data.roadmaps : [];
    const roadmaps = rawMaps.filter(
        (r): r is Roadmap =>
            isObj(r) && typeof r.id === 'string' && typeof r.title === 'string' && Array.isArray(r.milestones),
    );
    const rawPeople = Array.isArray(data.stakeholders) ? data.stakeholders : [];
    const stakeholders = rawPeople.filter(
        (m): m is StakeholderMap =>
            isObj(m) && typeof m.id === 'string' && typeof m.title === 'string' && Array.isArray(m.stakeholders),
    );
    const rawProducts = Array.isArray(data.products) ? data.products : [];
    const products = rawProducts.filter(
        (product): product is Product =>
            isObj(product) && typeof product.id === 'string' && typeof product.title === 'string' && Array.isArray(product.tasks),
    );
    if (
        tasks.length !== data.tasks.length ||
        tags.length !== data.tags.length ||
        roadmaps.length !== rawMaps.length ||
        stakeholders.length !== rawPeople.length ||
        products.length !== rawProducts.length
    ) {
        throw new Error('Часть записей в файле повреждена, загрузка отменена.');
    }
    // старые копии могли быть без каких-то полей — достраиваем значения по умолчанию
    const fixed = tasks.map((t): Task => ({
        description: '',
        list: 'backlog' as const,
        plannedFor: null,
        plannedAt: null,
        tagIds: [],
        comments: [],
        done: false,
        doneAt: null,
        createdAt: new Date().toISOString(),
        ...t,
    }));
    return {tasks: fixed, tags, roadmaps, stakeholders, products};
}

export function BackupMenu({
    backend,
    tasks,
    tags,
    roadmaps,
    stakeholders,
    products,
    onResult,
}: {
    backend: Backend | null;
    tasks: Task[];
    tags: Tag[];
    roadmaps: Roadmap[];
    stakeholders: StakeholderMap[];
    products: Product[];
    onResult: (r: {ok: boolean; message: string; code?: string}) => void;
}) {
    const fileRef = React.useRef<HTMLInputElement>(null);
    const [pending, setPending] = React.useState<Parsed | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [historyOpen, setHistoryOpen] = React.useState(false);
    const [historyBusy, setHistoryBusy] = React.useState(false);
    const [snapshots, setSnapshots] = React.useState<BackupSnapshot[]>([]);
    const [restoring, setRestoring] = React.useState<BackupSnapshot | null>(null);
    const [restoreBusy, setRestoreBusy] = React.useState(false);

    const download = () => {
        const body = JSON.stringify(
            {version: 1, exportedAt: new Date().toISOString(), tasks, tags, roadmaps, stakeholders, products},
            null,
            2,
        );
        const url = URL.createObjectURL(new Blob([body], {type: 'application/json'}));
        const a = document.createElement('a');
        a.href = url;
        a.download = `muravey-backup-${dayKey()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const pick = async (file: File) => {
        try {
            const parsed = parseBackup(await file.text());
            const taskIds = new Set(tasks.map((t) => t.id));
            const tagIds = new Set(tags.map((t) => t.id));
            setPending({
                ...parsed,
                newTasks: parsed.tasks.filter((t) => !taskIds.has(t.id)).length,
                newTags: parsed.tags.filter((t) => !tagIds.has(t.id)).length,
            });
        } catch (e) {
            onResult({ok: false, message: (e as Error).message});
        }
    };

    const apply = async () => {
        if (!pending || !backend) return;
        setBusy(true);
        try {
            await backend.importAll(pending.tasks, pending.tags, pending.roadmaps, pending.stakeholders, pending.products);
            onResult({
                ok: true,
                message:
                    `Загружено: задач ${pending.tasks.length}, тегов ${pending.tags.length}` +
                    (pending.roadmaps.length ? `, дорожных карт ${pending.roadmaps.length}` : '') +
                    (pending.stakeholders.length ? `, карт стейкхолдеров ${pending.stakeholders.length}` : '') +
                    (pending.products.length ? `, продуктов ${pending.products.length}.` : '.'),
            });
            setPending(null);
        } catch (e) {
            onResult({ok: false, message: 'Не получилось загрузить копию: ' + (e as Error).message});
        } finally {
            setBusy(false);
        }
    };

    const openHistory = async () => {
        if (!backend?.listBackups) return;
        setHistoryOpen(true);
        setRestoring(null);
        setHistoryBusy(true);
        try {
            setSnapshots(await backend.listBackups());
        } catch (e) {
            onResult({
                ok: false,
                message: 'Не получилось получить автоматические копии: ' + (e as Error).message,
                code: (e as {code?: string}).code,
            });
        } finally {
            setHistoryBusy(false);
        }
    };

    const restore = async () => {
        if (!restoring || !backend?.restoreBackup) return;
        setRestoreBusy(true);
        try {
            await backend.restoreBackup(restoring.slot);
            setHistoryOpen(false);
            setRestoring(null);
            onResult({ok: true, message: 'Данные восстановлены из автоматической копии.'});
        } catch (e) {
            onResult({
                ok: false,
                message: 'Не получилось восстановить копию: ' + (e as Error).message,
                code: (e as {code?: string}).code,
            });
        } finally {
            setRestoreBusy(false);
        }
    };

    return (
        <>
            <DropdownMenu
                renderSwitcher={(props) => (
                    <Button {...props} view="outlined" size="m" aria-label="Ещё">
                        <Icon data={Ellipsis} size={16} />
                    </Button>
                )}
                items={[
                    {
                        text: 'Скачать резервную копию',
                        iconStart: <Icon data={ArrowDownToLine} size={16} />,
                        action: download,
                    },
                    ...(backend?.listBackups && backend.restoreBackup
                        ? [
                              {
                                  text: 'Автоматические копии',
                                  iconStart: <Icon data={ArrowUturnCcwLeft} size={16} />,
                                  action: () => void openHistory(),
                              },
                          ]
                        : []),
                    {
                        text: 'Загрузить из файла',
                        iconStart: <Icon data={ArrowUpFromLine} size={16} />,
                        action: () => fileRef.current?.click(),
                        disabled: !backend,
                    },
                    ...(backend?.signOut
                        ? [
                              {
                                  text: 'Выйти',
                                  iconStart: <Icon data={ArrowRightFromSquare} size={16} />,
                                  action: () => void backend.signOut?.(),
                              },
                          ]
                        : []),
                ]}
            />
            <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) pick(f);
                }}
            />
            <Dialog open={Boolean(pending)} onClose={() => !busy && setPending(null)} size="s">
                <Dialog.Header caption="Загрузить резервную копию?" />
                <Dialog.Body>
                    {pending && (
                        <>
                            В файле задач: {pending.tasks.length} (новых {pending.newTasks}, обновятся{' '}
                            {pending.tasks.length - pending.newTasks}), тегов: {pending.tags.length} (новых{' '}
                            {pending.newTags}, обновятся {pending.tags.length - pending.newTags})
                            {pending.roadmaps.length > 0 && `, дорожных карт: ${pending.roadmaps.length}`}
                            {pending.stakeholders.length > 0 && `, карт стейкхолдеров: ${pending.stakeholders.length}`}
                            {pending.products.length > 0 && `, продуктов: ${pending.products.length}`}.
                            <br />
                            <br />
                            Записи с теми же id перезапишутся версией из файла. Всё остальное останется как есть,
                            ничего не удалится.
                        </>
                    )}
                </Dialog.Body>
                <Dialog.Footer
                    textButtonApply="Загрузить"
                    textButtonCancel="Отмена"
                    loading={busy}
                    onClickButtonApply={apply}
                    onClickButtonCancel={() => setPending(null)}
                />
            </Dialog>
            <Dialog
                open={historyOpen}
                onClose={() => {
                    if (restoreBusy) return;
                    if (restoring) setRestoring(null);
                    else setHistoryOpen(false);
                }}
                size="m"
            >
                <Dialog.Header caption={restoring ? 'Восстановить эту копию?' : 'Автоматические копии'} />
                <Dialog.Body>
                    {restoring ? (
                        <>
                            Текущие данные заменятся копией от{' '}
                            <strong>{fmtBackup.format(new Date(restoring.savedAt))}</strong>: задач {restoring.tasks},
                            тегов {restoring.tags}, дорожных карт {restoring.roadmaps}, карт стейкхолдеров{' '}
                            {restoring.stakeholders}, продуктов {restoring.products}.
                            <br />
                            <br />
                            Перед восстановлением сервер сохранит и текущее состояние, поэтому этот откат тоже можно
                            будет отменить.
                        </>
                    ) : (
                        <>
                            <p className="mv-backup-history__hint">
                                Перед каждым изменением сервер сохраняет предыдущее состояние. Выберите копию, чтобы
                                восстановить задачи, теги, дорожные карты, стейкхолдеров и продукты вместе.
                            </p>
                            {historyBusy ? (
                                <div className="mv-backup-history__loading">
                                    <Loader size="m" />
                                </div>
                            ) : snapshots.length ? (
                                <div className="mv-backup-list">
                                    {snapshots.map((snapshot) => (
                                        <button
                                            type="button"
                                            className="mv-backup-snapshot"
                                            key={snapshot.slot}
                                            onClick={() => setRestoring(snapshot)}
                                        >
                                            <span className="mv-backup-snapshot__date">
                                                {fmtBackup.format(new Date(snapshot.savedAt))}
                                            </span>
                                            <span className="mv-backup-snapshot__counts">
                                                Задач: {snapshot.tasks} · тегов: {snapshot.tags} · дорожных карт:{' '}
                                                {snapshot.roadmaps} · карт стейкхолдеров: {snapshot.stakeholders} · продуктов:{' '}
                                                {snapshot.products}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p>Автоматических копий пока нет. Первая появится перед следующим изменением данных.</p>
                            )}
                        </>
                    )}
                </Dialog.Body>
                {restoring ? (
                    <Dialog.Footer
                        textButtonApply="Восстановить"
                        textButtonCancel="Назад"
                        loading={restoreBusy}
                        onClickButtonApply={restore}
                        onClickButtonCancel={() => !restoreBusy && setRestoring(null)}
                    />
                ) : (
                    <Dialog.Footer textButtonCancel="Закрыть" onClickButtonCancel={() => setHistoryOpen(false)} />
                )}
            </Dialog>
        </>
    );
}
