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
    touchedAt?: string | null; // последнее действие с задачей — им кормится обезьяна
    milestoneId?: string | null; // веха дорожной карты, к которой привязана задача
    stakeholderId?: string | null; // стейкхолдер, с которым связана задача
    dueDate?: string | null; // YYYY-MM-DD: до этого дня задача ждёт в бэклоге, в этот день она в «Сегодня»
}

export interface Tag {
    id: string;
    name: string;
    theme: TagTheme;
    createdAt: string;
}

export type RoadmapScale = 'months' | 'years';

/** Веха дорожной карты: полоса на ганте от start до end включительно. */
export interface Milestone {
    id: string;
    title: string;
    start: string; // YYYY-MM-DD
    end: string; // YYYY-MM-DD
    /** ответственный, просто текстом */
    owner?: string;
    /** вехи, которые блокируют эту: она начинается не раньше, чем они закончатся */
    blockedBy?: string[];
    /** нет — веха в работе */
    status?: MilestoneStatus;
    /** описание риска, когда status === 'risk' */
    risk?: string;
}

export type MilestoneStatus = 'done' | 'risk';

/** Дорожная карта — отдельная от задач сущность: проект или продукт, разбитый на вехи. */
export interface Roadmap {
    id: string;
    title: string;
    scale: RoadmapScale;
    /** описание в markdown, как у задачи */
    description?: string;
    /** период на ганте: с первого месяца по последний включительно, YYYY-MM */
    from: string;
    to: string;
    milestones: Milestone[];
    createdAt: string;
    /** ключ публичной ссылки; выдаёт и отзывает сервер */
    shareId?: string | null;
}

export type Attitude = 'ally' | 'neutral' | 'skeptic';
export type ContactKind = 'meeting' | 'call' | 'message' | 'demo' | 'other';
export type Outcome = 'good' | 'neutral' | 'bad';

/** Запись в истории взаимодействий со стейкхолдером. */
export interface Interaction {
    id: string;
    date: string; // YYYY-MM-DD
    kind: ContactKind;
    text: string;
    outcome?: Outcome;
    /** задача, после закрытия которой появилась запись */
    taskId?: string;
}

export interface Stakeholder {
    id: string;
    name: string;
    /** роль и компания или продукт группы */
    role?: string;
    contact?: string;
    attitude?: Attitude;
    description?: string;
    /** место на матрице, от 0 до 1: интерес слева направо, влияние снизу вверх */
    interest: number;
    influence: number;
    history: Interaction[];
    createdAt: string;
}

/** Карта стейкхолдеров одного продукта. */
export interface StakeholderMap {
    id: string;
    title: string;
    stakeholders: Stakeholder[];
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
    // задача с датой сама приходит в «Сегодня» в свой день, а на следующий возвращается в бэклог, как и все
    if (t.list !== 'focus' && t.dueDate === today) return 'today';
    if (t.list === 'today' && t.plannedFor !== today) return 'backlog';
    return t.list;
}

/** Ключ сортировки внутри списка: ручной порядок, а без него — правило по умолчанию. */
export function sortKey(t: Task, list: ListKind): number {
    if (t.order != null && t.list === list) return t.order;
    if (list === 'backlog') return -Date.parse(t.createdAt); // новые сверху
    return 1e13 + Date.parse((list === 'today' && t.plannedAt) || t.createdAt); // новые снизу
}

const HUNGRY_DAYS = 7;
const DAY_MS = 864e5;

/** Когда с задачей что-то делали в последний раз (у старых задач — по тому, что известно). */
export function lastTouch(t: Task): number {
    const marks = [t.touchedAt, t.createdAt, t.plannedAt, ...t.comments.map((c) => c.at)];
    return Math.max(...marks.map((m) => (m ? Date.parse(m) : 0)).filter((x) => !Number.isNaN(x)));
}

/** Обезьяна голодна: с открытой задачей неделю ничего не происходило. Возвращает, сколько дней. */
export function hungryDays(t: Task, now = Date.now()): number | null {
    if (t.done) return null;
    const days = Math.floor((now - lastTouch(t)) / DAY_MS);
    return days >= HUNGRY_DAYS ? days : null;
}

/** Голод с учётом фокусных задач: сама фокусная не голодает, она голодна, пока голодна хоть одна её подзадача. */
export function hungerOf(t: Task, all: Task[], now = Date.now()): number | null {
    if (t.done) return null;
    if (t.list !== 'focus') return hungryDays(t, now);
    let worst: number | null = null;
    for (const k of all) {
        if (k.parentId !== t.id || k.list === 'focus') continue;
        const d = hungryDays(k, now);
        if (d !== null && (worst === null || d > worst)) worst = d;
    }
    return worst;
}

/** Открытые задачи стейкхолдера; нет ни одной — стейкхолдер голоден, его пора покормить следующим контактом. */
export const openTasksOf = (s: Pick<Stakeholder, 'id'>, all: Task[]) =>
    all.filter((t) => t.stakeholderId === s.id && !t.done);

export function addDays(day: string, n: number) {
    const d = new Date(day + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return dayKey(d);
}
