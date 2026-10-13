export type ListKind = 'backlog' | 'today' | 'focus';

export type TagTheme = 'normal' | 'info' | 'success' | 'warning' | 'danger' | 'utility' | 'unknown';

export interface Comment {
    id: string;
    text: string;
    at: string; // ISO
}

export interface Task {
    id: string;
    title: string;
    description: string;
    list: ListKind;
    plannedFor: string | null; // YYYY-MM-DD, только для list === 'today'
    plannedAt: string | null;
    tagIds: string[];
    comments: Comment[];
    done: boolean;
    doneAt: string | null;
    createdAt: string;
    order?: number | null; // ручная сортировка внутри списка
    parentId?: string | null; // фокусная задача, для которой эта — подзадача
}

export interface Tag {
    id: string;
    name: string;
    theme: TagTheme;
    createdAt: string;
}

export const TAG_THEMES: TagTheme[] = ['info', 'success', 'warning', 'danger', 'utility', 'normal'];

export function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function dayKey(d = new Date()) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Задача «на сегодня» живёт только в свой день; на следующий день она снова в бэклоге. */
export function effectiveList(t: Task, today: string): ListKind {
    if (t.list === 'today' && t.plannedFor !== today) return 'backlog';
    return t.list;
}

/** Ключ сортировки внутри списка: ручной порядок, а без него — правило по умолчанию. */
export function sortKey(t: Task, list: ListKind): number {
    if (t.order != null && t.list === list) return t.order;
    if (list === 'backlog') return -Date.parse(t.createdAt); // новые сверху
    return 1e13 + Date.parse((list === 'today' && t.plannedAt) || t.createdAt); // новые снизу
}
