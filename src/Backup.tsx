import React from 'react';
import {Button, Dialog, DropdownMenu, Icon} from '@gravity-ui/uikit';
import {ArrowDownToLine, ArrowRightFromSquare, ArrowUpFromLine, Ellipsis} from '@gravity-ui/icons';

import type {Backend} from './store';
import type {Roadmap, Tag, Task} from './types';
import {dayKey} from './types';

interface Parsed {
    tasks: Task[];
    tags: Tag[];
    roadmaps: Roadmap[];
    newTasks: number;
    newTags: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function parseBackup(text: string): {tasks: Task[]; tags: Tag[]; roadmaps: Roadmap[]} {
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
    if (tasks.length !== data.tasks.length || tags.length !== data.tags.length || roadmaps.length !== rawMaps.length) {
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
    return {tasks: fixed, tags, roadmaps};
}

export function BackupMenu({
    backend,
    tasks,
    tags,
    roadmaps,
    onResult,
}: {
    backend: Backend | null;
    tasks: Task[];
    tags: Tag[];
    roadmaps: Roadmap[];
    onResult: (r: {ok: boolean; message: string}) => void;
}) {
    const fileRef = React.useRef<HTMLInputElement>(null);
    const [pending, setPending] = React.useState<Parsed | null>(null);
    const [busy, setBusy] = React.useState(false);

    const download = () => {
        const body = JSON.stringify({version: 1, exportedAt: new Date().toISOString(), tasks, tags, roadmaps}, null, 2);
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
            await backend.importAll(pending.tasks, pending.tags, pending.roadmaps);
            onResult({
                ok: true,
                message:
                    `Загружено: задач ${pending.tasks.length}, тегов ${pending.tags.length}` +
                    (pending.roadmaps.length ? `, дорожных карт ${pending.roadmaps.length}.` : '.'),
            });
            setPending(null);
        } catch (e) {
            onResult({ok: false, message: 'Не получилось загрузить копию: ' + (e as Error).message});
        } finally {
            setBusy(false);
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
                            {pending.roadmaps.length > 0 && `, дорожных карт: ${pending.roadmaps.length}`}.
                            <br />
                            <br />
                            Задачи и теги с теми же id перезапишутся версией из файла. Всё остальное останется как есть,
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
        </>
    );
}
