import React from 'react';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCenter,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type {DragEndEvent} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    rectSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import {
    ActionTooltip,
    Button,
    Checkbox,
    Dialog,
    DropdownMenu,
    Icon,
    Label,
    Loader,
    Select,
    Text,
    TextArea,
    TextInput,
} from '@gravity-ui/uikit';
import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ChartLine,
    CopyPlus,
    Cube,
    Grip,
    Plus,
    TextAlignLeft,
    TrashBin,
    Xmark,
} from '@gravity-ui/icons';

import {DescriptionEditor} from './DescriptionEditor';
import {SaveStatus, useAutosave} from './SaveStatus';
import type {Product, ProductRoleId, ProductTask, ProductTaskStatus} from './types';
import {PRODUCT_ROLE_IDS, uid} from './types';
import logo from './assets/logo.png';

export const PRODUCT_ROLES: Record<ProductRoleId, string> = {
    projectManager: 'Руководитель проекта',
    architect: 'Архитектор',
    artDirector: 'Арт-директор',
    qaLead: 'QA лид',
    systemAnalyst: 'Системный аналитик',
    iosDeveloper: 'iOS разработчик',
    androidDeveloper: 'Android разработчик',
    backendEngineer: 'Backend инженер',
    frontendEngineer: 'Frontend инженер',
    qa: 'QA',
    designer: 'UX/UI дизайнер',
    businessAnalyst: 'Бизнес-аналитик',
};

export const PRODUCT_STATUSES: Record<ProductTaskStatus, string> = {
    new: 'Новое',
    estimation: 'Передано на оценку',
    estimated: 'Оценено',
    inProgress: 'В работе',
    done: 'Реализовано',
    archive: 'Архив',
};

const STATUS_THEMES: Record<ProductTaskStatus, 'normal' | 'info' | 'utility' | 'warning' | 'success'> = {
    new: 'normal',
    estimation: 'warning',
    estimated: 'utility',
    inProgress: 'info',
    done: 'success',
    archive: 'normal',
};

const numberFormat = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2});
const dateFormat = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', year: 'numeric'});

export function totalEffort(task: Pick<ProductTask, 'estimates'>) {
    return Object.values(task.estimates).reduce<number>(
        (sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0),
        0,
    );
}

export function riceScore(task: Pick<ProductTask, 'reach' | 'impact' | 'confidence' | 'estimates'>) {
    return (Math.max(0, task.reach) * task.impact * (Math.min(100, Math.max(0, task.confidence)) / 100)) /
        Math.max(1, totalEffort(task));
}

const PRODUCT_STATUS_ORDER = Object.keys(PRODUCT_STATUSES) as ProductTaskStatus[];
const STATUS_DROP_PREFIX = 'product-status:';
const byRice = (a: ProductTask, b: ProductTask) =>
    riceScore(b) - riceScore(a) || b.createdAt.localeCompare(a.createdAt);
const byProductOrder = (a: Product, b: Product) =>
    (a.order ?? -Date.parse(a.createdAt)) - (b.order ?? -Date.parse(b.createdAt)) ||
    b.createdAt.localeCompare(a.createdAt);
const statusOptions = PRODUCT_STATUS_ORDER.map((value) => ({
    value,
    content: PRODUCT_STATUSES[value],
}));

function featuresWord(count: number) {
    const a = count % 10;
    const b = count % 100;
    const word = a === 1 && b !== 11 ? 'задача' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'задачи' : 'задач';
    return `${count} ${word}`;
}

function newProductTask(): ProductTask {
    return {
        id: uid(),
        title: '',
        description: '',
        status: 'new',
        reach: 1,
        impact: 1,
        confidence: 100,
        estimates: {},
        createdAt: new Date().toISOString(),
    };
}

type ProductsProps = {
    products: Product[] | null;
    productId: string | null;
    onOpenProduct: (id: string | null) => void;
    disabled: boolean;
    onSave: (product: Product) => Promise<void> | null;
    onRemove: (product: Product) => void;
    undoable: (title: string, undo: () => void) => void;
};

export function ProductsView(p: ProductsProps) {
    const [creating, setCreating] = React.useState(false);
    const [title, setTitle] = React.useState('');
    const [activeProductId, setActiveProductId] = React.useState<string | null>(null);
    const sensors = useSensors(
        useSensor(MouseSensor, {activationConstraint: {distance: 5}}),
        useSensor(TouchSensor, {activationConstraint: {delay: 200, tolerance: 6}}),
        useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}),
    );
    const product = p.products?.find((item) => item.id === p.productId);

    if (p.products === null) {
        return (
            <div className="mv-loading">
                <Loader size="m" />
                <Text color="secondary">Загружаю продукты…</Text>
            </div>
        );
    }
    if (product) return <ProductPage key={product.id} {...p} product={product} />;

    const sorted = [...p.products].sort(byProductOrder);
    const activeProduct = sorted.find((item) => item.id === activeProductId);
    const onProductDragEnd = ({active, over}: DragEndEvent) => {
        setActiveProductId(null);
        if (!over || active.id === over.id) return;
        const from = sorted.findIndex((item) => item.id === String(active.id));
        const to = sorted.findIndex((item) => item.id === String(over.id));
        if (from < 0 || to < 0) return;
        arrayMove(sorted, from, to).forEach((item, index) => {
            const order = index * 1024;
            if (item.order !== order) p.onSave({...item, order});
        });
    };
    const create = () => {
        const name = title.trim();
        if (!name) return;
        const item: Product = {
            id: uid(),
            title: name,
            description: '',
            tasks: [],
            createdAt: new Date().toISOString(),
            order: Math.min(0, ...sorted.map((item) => item.order ?? 0)) - 1024,
        };
        p.onSave(item);
        setTitle('');
        setCreating(false);
        p.onOpenProduct(item.id);
    };

    return (
        <div className="mv-products">
            <section className="mv-products__hero">
                <div>
                    <span className="mv-day__eyebrow">ПРОДУКТОВЫЙ БЭКЛОГ</span>
                    <h2>Продукты</h2>
                    <p>Соберите фичи, оцените их вместе с командой и выберите самое ценное по RICE.</p>
                </div>
                <Button view="action" size="l" onClick={() => setCreating(true)} disabled={p.disabled}>
                    <Icon data={Plus} size={18} />
                    Создать продукт
                </Button>
            </section>

            {sorted.length === 0 ? (
                <div className="mv-maps-empty mv-products__empty">
                    <img src={logo} alt="" className="mv-maps-empty__ant" />
                    <Text variant="subheader-2">Создайте первый продукт</Text>
                    <Text color="secondary">Внутри появится таблица фич с приоритетами и оценками команды.</Text>
                    <Button view="outlined" onClick={() => setCreating(true)} disabled={p.disabled}>
                        <Icon data={Cube} size={16} />
                        Добавить продукт
                    </Button>
                </div>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={({active}) => setActiveProductId(String(active.id))}
                    onDragEnd={onProductDragEnd}
                    onDragCancel={() => setActiveProductId(null)}
                    accessibility={{
                        screenReaderInstructions: {
                            draggable: 'Пробел, чтобы взять продукт, стрелки, чтобы изменить порядок, пробел, чтобы отпустить.',
                        },
                    }}
                >
                    <SortableContext items={sorted.map((item) => item.id)} strategy={rectSortingStrategy} disabled={p.disabled}>
                        <ul className="mv-products__grid">
                            {sorted.map((item) => (
                                <SortableProductCard
                                    key={item.id}
                                    product={item}
                                    disabled={p.disabled}
                                    onOpen={() => p.onOpenProduct(item.id)}
                                />
                            ))}
                        </ul>
                    </SortableContext>
                    <DragOverlay>
                        {activeProduct && (
                            <div className="mv-product-drag-overlay">
                                <Icon data={Cube} size={18} />
                                <span>{activeProduct.title}</span>
                            </div>
                        )}
                    </DragOverlay>
                </DndContext>
            )}

            <Dialog open={creating} onClose={() => setCreating(false)} size="s" aria-label="Новый продукт">
                <Dialog.Header caption="Новый продукт" />
                <Dialog.Body>
                    <TextInput
                        size="l"
                        autoFocus
                        value={title}
                        onUpdate={setTitle}
                        onKeyDown={(event) => event.key === 'Enter' && create()}
                        placeholder="Название продукта"
                        aria-label="Название продукта"
                    />
                </Dialog.Body>
                <Dialog.Footer
                    textButtonApply="Создать"
                    textButtonCancel="Отмена"
                    propsButtonApply={{disabled: !title.trim()}}
                    onClickButtonApply={create}
                    onClickButtonCancel={() => setCreating(false)}
                />
            </Dialog>
        </div>
    );
}

function SortableProductCard({product, disabled, onOpen}: {product: Product; disabled: boolean; onOpen: () => void}) {
    const dnd = useSortable({id: product.id, disabled});
    const active = product.tasks.filter((task) => task.status !== 'archive').length;
    const leader = [...product.tasks].sort(byRice)[0];
    return (
        <li
            ref={dnd.setNodeRef}
            className={`mv-product-card-shell${dnd.isDragging ? ' mv-product-card-shell_dragging' : ''}`}
            style={{transform: CSS.Transform.toString(dnd.transform), transition: dnd.transition}}
        >
            <div className="mv-product-card">
                <button type="button" className="mv-product-card__body" onClick={onOpen}>
                    <span className="mv-product-card__icon"><Icon data={Cube} size={22} /></span>
                    <span className="mv-product-card__title">{product.title}</span>
                    <span className="mv-product-card__description">
                        {product.description?.trim() || 'Бэклог продукта и приоритизация фич'}
                    </span>
                    <span className="mv-product-card__stats">
                        <span><strong>{featuresWord(product.tasks.length)}</strong></span>
                        <span>{active} вне архива</span>
                    </span>
                    {leader && (
                        <span className="mv-product-card__leader">
                            <Icon data={ChartLine} size={15} />
                            <span>{leader.title || 'Без названия'}</span>
                            <strong>{numberFormat.format(riceScore(leader))}</strong>
                        </span>
                    )}
                    <span className="mv-product-card__open">
                        Открыть продукт <Icon data={ArrowRight} size={15} />
                    </span>
                </button>
                <button
                    ref={dnd.setActivatorNodeRef}
                    type="button"
                    className="mv-product-card__drag"
                    {...dnd.attributes}
                    {...dnd.listeners}
                    disabled={disabled}
                    aria-label={`Переместить продукт ${product.title}`}
                    title="Перетащить продукт"
                >
                    <Icon data={Grip} size={17} />
                </button>
            </div>
        </li>
    );
}

function ProductPage({product, ...p}: ProductsProps & {product: Product}) {
    const [title, setTitle] = React.useState(product.title);
    const [openTaskId, setOpenTaskId] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState<ProductTask | null>(null);
    const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
    const sensors = useSensors(
        useSensor(MouseSensor, {activationConstraint: {distance: 5}}),
        useSensor(TouchSensor, {activationConstraint: {delay: 200, tolerance: 6}}),
        useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}),
    );
    const productRef = React.useRef(product);
    productRef.current = product;
    const draftRef = React.useRef<ProductTask | null>(null);
    const auto = useAutosave<Product>((patch) => p.onSave({...productRef.current, ...patch}));

    const patchTask = (id: string, patch: Partial<ProductTask>): Promise<void> | null => {
        const stored = productRef.current.tasks.find((task) => task.id === id);
        const source = stored ?? (draftRef.current?.id === id ? draftRef.current : undefined);
        if (!source) return null;
        const next = {...source, ...patch};
        if (!stored) {
            draftRef.current = next;
            setDraft(next);
            if (!next.title.trim()) return null;
        }
        const exists = Boolean(stored);
        const tasks = exists
            ? productRef.current.tasks.map((task) => (task.id === id ? next : task))
            : [...productRef.current.tasks, next];
        return p.onSave({...productRef.current, tasks});
    };

    const addTask = () => {
        const task = newProductTask();
        draftRef.current = task;
        setDraft(task);
        setOpenTaskId(task.id);
    };

    const closeTask = () => {
        setOpenTaskId(null);
        setDraft(null);
        draftRef.current = null;
    };

    const duplicateTask = (source: ProductTask) => {
        const current = productRef.current;
        const original = current.tasks.find((task) => task.id === source.id) ?? source;
        const copy: ProductTask = {
            ...original,
            id: uid(),
            title: `${original.title || 'Без названия'} — копия`,
            estimates: {...original.estimates},
            createdAt: new Date().toISOString(),
        };
        p.onSave({...current, tasks: [...current.tasks, copy]});
        setDraft(null);
        draftRef.current = null;
        setOpenTaskId(copy.id);
    };

    const removeTask = (source: ProductTask) => {
        const current = productRef.current;
        const original = current.tasks.find((task) => task.id === source.id) ?? source;
        if (openTaskId === original.id) closeTask();
        p.onSave({...current, tasks: current.tasks.filter((task) => task.id !== original.id)});
        p.undoable(`Задача «${original.title}» удалена`, () => {
            const latest = productRef.current;
            if (!latest.tasks.some((task) => task.id === original.id)) {
                p.onSave({...latest, tasks: [...latest.tasks, original]});
            }
        });
    };

    const onTaskDragEnd = ({active, over}: DragEndEvent) => {
        setActiveTaskId(null);
        if (!over) return;
        const current = productRef.current;
        const task = current.tasks.find((item) => item.id === String(active.id));
        if (!task) return;
        const overId = String(over.id);
        let status: ProductTaskStatus | undefined;
        if (overId.startsWith(STATUS_DROP_PREFIX)) {
            const candidate = overId.slice(STATUS_DROP_PREFIX.length) as ProductTaskStatus;
            if (PRODUCT_STATUS_ORDER.includes(candidate)) status = candidate;
        } else {
            status = current.tasks.find((item) => item.id === overId)?.status;
        }
        if (!status || status === task.status) return;
        const previous = task.status;
        p.onSave({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? {...item, status} : item)),
        });
        p.undoable(`Задача «${task.title}» перенесена в «${PRODUCT_STATUSES[status]}»`, () => {
            const latest = productRef.current;
            p.onSave({
                ...latest,
                tasks: latest.tasks.map((item) => (item.id === task.id ? {...item, status: previous} : item)),
            });
        });
    };

    const storedCard = product.tasks.find((task) => task.id === openTaskId) ?? null;
    const cardTask = storedCard ?? (draft?.id === openTaskId ? draft : null);
    const groups = PRODUCT_STATUS_ORDER.map((status) => ({
        status,
        tasks: product.tasks.filter((task) => task.status === status).sort(byRice),
    }));
    const sorted = groups.flatMap((group) => group.tasks);
    const activeTask = sorted.find((task) => task.id === activeTaskId);
    const inProgress = product.tasks.filter((task) => task.status === 'inProgress').length;

    return (
        <div className="mv-product">
            <div className="mv-map__head">
                <Button view="flat" size="m" onClick={() => p.onOpenProduct(null)}>
                    <Icon data={ArrowLeft} size={16} />
                    Все продукты
                </Button>
                <DropdownMenu
                    size="m"
                    items={[
                        {
                            text: 'Добавить задачу',
                            iconStart: <Icon data={Plus} size={16} />,
                            action: addTask,
                        },
                        {
                            text: 'Удалить продукт',
                            theme: 'danger',
                            iconStart: <Icon data={TrashBin} size={16} />,
                            action: () => {
                                p.onOpenProduct(null);
                                p.onRemove(productRef.current);
                            },
                        },
                    ]}
                />
            </div>

            <section className="mv-product__heading">
                <div className="mv-product__title-row">
                    <span className="mv-product__mark"><Icon data={Cube} size={24} /></span>
                    <TextInput
                        view="clear"
                        size="xl"
                        className="mv-map__title mv-product__title"
                        value={title}
                        onUpdate={(value) => {
                            setTitle(value);
                            if (value.trim()) auto.schedule({title: value.trim()});
                        }}
                        onBlur={() => {
                            if (!title.trim()) setTitle(product.title);
                            auto.flush();
                        }}
                        onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
                        aria-label="Название продукта"
                    />
                </div>
                <div className="mv-product__summary">
                    <span><strong>{product.tasks.length}</strong> всего</span>
                    <span><strong>{inProgress}</strong> в работе</span>
                    <span><strong>{product.tasks.filter((task) => task.status === 'archive').length}</strong> в архиве</span>
                    <SaveStatus state={auto.state} idle="" />
                </div>
            </section>

            <section className="mv-field mv-product__about">
                <Text variant="subheader-1">О продукте</Text>
                <DescriptionEditor
                    value={product.description ?? ''}
                    onChange={(description) => auto.schedule({description})}
                    onSubmit={auto.flush}
                    placeholder="Коротко о продукте, его целях и аудитории"
                />
            </section>

            <section className="mv-product-backlog" aria-labelledby="mv-product-backlog-title">
                <div className="mv-product-backlog__head">
                    <div>
                        <Text variant="subheader-2" as="h3" id="mv-product-backlog-title">Задачи продукта</Text>
                        <Text variant="caption-2" color="secondary">
                            Приоритет рассчитывается автоматически
                        </Text>
                    </div>
                    <div className="mv-product-backlog__actions">
                        <Button view="action" onClick={addTask} disabled={p.disabled}>
                            <Icon data={Plus} size={16} />
                            Добавить задачу
                        </Button>
                    </div>
                </div>

                {product.tasks.length > 0 ? (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={({active}) => setActiveTaskId(String(active.id))}
                        onDragEnd={onTaskDragEnd}
                        onDragCancel={() => setActiveTaskId(null)}
                        accessibility={{
                            screenReaderInstructions: {
                                draggable:
                                    'Пробел, чтобы взять задачу, стрелки, чтобы выбрать группу статуса, пробел, чтобы отпустить.',
                            },
                        }}
                    >
                        <div className="mv-product-table-wrap">
                            <SortableContext
                                items={sorted.map((task) => task.id)}
                                strategy={verticalListSortingStrategy}
                                disabled={p.disabled}
                            >
                                <table className="mv-product-table">
                                    <thead>
                                        <tr>
                                            <th className="mv-product-table__rank">#</th>
                                            <th>Название фичи</th>
                                            <th>Статус</th>
                                            <th className="mv-product-table__number">Reach</th>
                                            <th className="mv-product-table__number">Impact</th>
                                            <th className="mv-product-table__number">Confidence</th>
                                            <th className="mv-product-table__number">Σ оценка</th>
                                            <th className="mv-product-table__score">
                                                <span>RICE Score <Icon data={ArrowDown} size={13} /></span>
                                            </th>
                                            <th><span className="mv-visually-hidden">Действия</span></th>
                                        </tr>
                                    </thead>
                                    {groups.map((group) => (
                                        <ProductStatusGroup
                                            key={group.status}
                                            status={group.status}
                                            tasks={group.tasks}
                                            dragging={Boolean(activeTask)}
                                            disabled={p.disabled}
                                            onOpen={setOpenTaskId}
                                            onDuplicate={duplicateTask}
                                            onDelete={removeTask}
                                        />
                                    ))}
                                </table>
                            </SortableContext>
                        </div>
                        <DragOverlay>
                            {activeTask && (
                                <div className="mv-product-task-drag">
                                    <Icon data={Grip} size={16} />
                                    <span>{activeTask.title || 'Без названия'}</span>
                                    <strong>{numberFormat.format(riceScore(activeTask))}</strong>
                                </div>
                            )}
                        </DragOverlay>
                    </DndContext>
                ) : (
                    <div className="mv-product-backlog__empty">
                        <span className="mv-product-backlog__empty-icon"><Icon data={ChartLine} size={24} /></span>
                        <Text variant="subheader-1">Добавьте первую фичу</Text>
                        <Text color="secondary">
                            Заполните RICE-параметры и оценки команды — таблица сама построит приоритеты.
                        </Text>
                        <Button view="outlined" onClick={addTask} disabled={p.disabled}>
                            <Icon data={Plus} size={16} />
                            Создать задачу
                        </Button>
                    </div>
                )}
                {product.tasks.length > 0 && (
                    <div className="mv-product-backlog__foot">
                        <Text variant="caption-2" color="secondary">
                            Внутри каждого статуса — по убыванию RICE. За значок <span aria-hidden="true">⋮⋮</span> задачу можно перенести в другой статус.
                        </Text>
                    </div>
                )}
            </section>

            <Dialog
                open={Boolean(cardTask)}
                onClose={closeTask}
                hasCloseButton={false}
                maxWidth="m"
                fullWidth
                contentOverflow="auto"
                aria-label="Задача продукта"
                modalClassName="mv-task-modal mv-product-task-modal"
            >
                {cardTask && (
                    <ProductTaskDetails
                        key={cardTask.id}
                        task={cardTask}
                        isNew={!storedCard}
                        onPatch={(patch) => patchTask(cardTask.id, patch)}
                        onClose={closeTask}
                        onDuplicate={() => duplicateTask(cardTask)}
                        onDelete={() => removeTask(cardTask)}
                    />
                )}
            </Dialog>
        </div>
    );
}

function ProductStatusGroup({
    status,
    tasks,
    dragging,
    disabled,
    onOpen,
    onDuplicate,
    onDelete,
}: {
    status: ProductTaskStatus;
    tasks: ProductTask[];
    dragging: boolean;
    disabled: boolean;
    onOpen: (id: string) => void;
    onDuplicate: (task: ProductTask) => void;
    onDelete: (task: ProductTask) => void;
}) {
    const drop = useDroppable({id: STATUS_DROP_PREFIX + status, disabled});
    return (
        <tbody ref={drop.setNodeRef} className={`mv-product-table__group${drop.isOver ? ' mv-product-table__group_over' : ''}`}>
            <tr className="mv-product-table__group-head">
                <th colSpan={9}>
                    <div>
                        <Label theme={STATUS_THEMES[status]} size="s">{PRODUCT_STATUSES[status]}</Label>
                        <span>{featuresWord(tasks.length)}</span>
                        {drop.isOver && <strong>Отпустите, чтобы перенести</strong>}
                    </div>
                </th>
            </tr>
            {tasks.map((task, index) => (
                <ProductTaskRow
                    key={task.id}
                    task={task}
                    rank={index + 1}
                    disabled={disabled}
                    onOpen={() => onOpen(task.id)}
                    onDuplicate={() => onDuplicate(task)}
                    onDelete={() => onDelete(task)}
                />
            ))}
            {tasks.length === 0 && (
                <tr className="mv-product-table__group-empty">
                    <td colSpan={9}>{dragging ? 'Перетащите задачу в этот статус' : 'Нет задач'}</td>
                </tr>
            )}
        </tbody>
    );
}

function ProductTaskRow({
    task,
    rank,
    disabled,
    onOpen,
    onDuplicate,
    onDelete,
}: {
    task: ProductTask;
    rank: number;
    disabled: boolean;
    onOpen: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const dnd = useSortable({id: task.id, disabled});
    return (
        <tr
            ref={dnd.setNodeRef}
            className={dnd.isDragging ? 'mv-product-table__row_dragging' : undefined}
            style={{transform: CSS.Translate.toString(dnd.transform), transition: dnd.transition}}
        >
            <td className="mv-product-table__rank" data-label="Приоритет">
                <span className="mv-product-table__rank-inner">
                    <button
                        ref={dnd.setActivatorNodeRef}
                        type="button"
                        className="mv-product-table__drag"
                        {...dnd.attributes}
                        {...dnd.listeners}
                        disabled={disabled}
                        aria-label={`Переместить задачу ${task.title}`}
                        aria-roledescription="перетаскиваемая задача"
                        title="Перетащить в другой статус"
                    >
                        <Icon data={Grip} size={14} />
                    </button>
                    <span>{rank}</span>
                </span>
            </td>
            <td className="mv-product-table__feature" data-label="Название фичи">
                <button type="button" onClick={onOpen}>
                    <span>{task.title || 'Без названия'}</span>
                    {task.description.trim() && <Icon data={TextAlignLeft} size={14} />}
                </button>
            </td>
            <td data-label="Статус">
                <Label theme={STATUS_THEMES[task.status]} size="s">
                    {PRODUCT_STATUSES[task.status]}
                </Label>
            </td>
            <td className="mv-product-table__number" data-label="Reach">{numberFormat.format(task.reach)}</td>
            <td className="mv-product-table__number" data-label="Impact">{task.impact}</td>
            <td className="mv-product-table__number" data-label="Confidence">{task.confidence}%</td>
            <td className="mv-product-table__number" data-label="Суммарная оценка">{numberFormat.format(totalEffort(task))}</td>
            <td className="mv-product-table__score" data-label="RICE Score">
                <button type="button" onClick={onOpen} aria-label={`Открыть задачу ${task.title}`}>
                    {numberFormat.format(riceScore(task))}
                </button>
            </td>
            <td className="mv-product-table__menu" onClick={(event) => event.stopPropagation()}>
                <DropdownMenu
                    size="s"
                    items={[
                        {
                            text: 'Дублировать',
                            iconStart: <Icon data={CopyPlus} size={16} />,
                            action: onDuplicate,
                        },
                        {
                            text: 'Удалить',
                            theme: 'danger',
                            iconStart: <Icon data={TrashBin} size={16} />,
                            action: onDelete,
                        },
                    ]}
                />
            </td>
        </tr>
    );
}

function ProductTaskDetails({
    task,
    isNew,
    onPatch,
    onClose,
    onDuplicate,
    onDelete,
}: {
    task: ProductTask;
    isNew: boolean;
    onPatch: (patch: Partial<ProductTask>) => Promise<void> | null;
    onClose: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const [title, setTitle] = React.useState(task.title);
    const auto = useAutosave<ProductTask>(onPatch);
    const close = () => {
        auto.flush();
        onClose();
    };
    const effort = totalEffort(task);
    const score = riceScore(task);
    const selected = (id: ProductRoleId) => Object.prototype.hasOwnProperty.call(task.estimates, id);
    const setRole = (id: ProductRoleId, enabled: boolean) => {
        const estimates = {...task.estimates};
        if (enabled) estimates[id] = null;
        else delete estimates[id];
        auto.save({estimates});
    };
    const setEstimate = (id: ProductRoleId, value: string) => {
        const estimate = value.trim() === '' ? null : Math.max(0, Number(value) || 0);
        auto.save({estimates: {...task.estimates, [id]: estimate}});
    };

    return (
        <div className="mv-details mv-product-details">
            <div className="mv-details__head">
                <Label theme={STATUS_THEMES[task.status]} size="s">
                    {isNew ? 'Новая задача продукта' : PRODUCT_STATUSES[task.status]}
                </Label>
                <SaveStatus
                    state={auto.state}
                    idle={isNew ? 'Сохранится после ввода названия' : `Создана ${dateFormat.format(new Date(task.createdAt))}`}
                />
                <div className="mv-details__actions">
                    {!isNew && (
                        <>
                            <ActionTooltip title="Дублировать">
                                <Button view="flat" size="m" onClick={onDuplicate} aria-label="Дублировать задачу">
                                    <Icon data={CopyPlus} size={17} />
                                </Button>
                            </ActionTooltip>
                            <ActionTooltip title="Удалить">
                                <Button view="flat-danger" size="m" onClick={onDelete} aria-label="Удалить задачу">
                                    <Icon data={TrashBin} size={17} />
                                </Button>
                            </ActionTooltip>
                        </>
                    )}
                </div>
                <Button view="flat" size="m" onClick={close} aria-label="Закрыть" className="mv-details__close">
                    <Icon data={Xmark} size={17} />
                </Button>
            </div>

            <TextArea
                view="clear"
                size="xl"
                minRows={1}
                autoFocus={isNew}
                className="mv-details__title"
                value={title}
                onUpdate={(value) => {
                    setTitle(value);
                    if (value.trim()) auto.schedule({title: value.trim()});
                }}
                onBlur={() => {
                    if (!title.trim()) setTitle(task.title);
                    auto.flush();
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        close();
                    }
                }}
                placeholder="Название фичи"
                aria-label="Название фичи"
            />

            <div className="mv-product-details__status">
                <Text variant="subheader-1" as="label" id="mv-product-status-label">Статус</Text>
                <Select
                    value={[task.status]}
                    onUpdate={([status]) => auto.save({status: status as ProductTaskStatus})}
                    options={statusOptions}
                    aria-labelledby="mv-product-status-label"
                    width={240}
                />
            </div>

            <section className="mv-field">
                <Text variant="subheader-1">Описание</Text>
                <DescriptionEditor
                    value={task.description}
                    onChange={(description) => auto.schedule({description})}
                    onSubmit={close}
                    placeholder="Цель фичи, сценарий использования, критерии готовности"
                />
            </section>

            <section className="mv-rice-card">
                <div className="mv-rice-card__score">
                    <span>RICE Score</span>
                    <strong>{numberFormat.format(score)}</strong>
                </div>
                <div className="mv-rice-card__formula">
                    <Text variant="caption-2" color="secondary">
                        {numberFormat.format(task.reach)} × {task.impact} × {numberFormat.format(task.confidence / 100)} ÷ {numberFormat.format(Math.max(1, effort))}
                    </Text>
                    <Text variant="caption-2" color="secondary">Чем выше оценка, тем приоритетнее задача</Text>
                </div>
            </section>

            <section className="mv-product-section">
                <div className="mv-product-section__head">
                    <Text variant="subheader-1">Параметры RICE</Text>
                    <Text variant="caption-2" color="secondary">Reach × Impact × Confidence</Text>
                </div>
                <div className="mv-rice-fields">
                    <label className="mv-rice-field">
                        <span>Reach</span>
                        <TextInput
                            type="number"
                            controlProps={{min: 0, step: 1}}
                            value={String(task.reach)}
                            onUpdate={(value) => auto.save({reach: Math.max(0, Number(value) || 0)})}
                            aria-label="Reach"
                        />
                        <small>Сколько пользователей затронет фича</small>
                    </label>
                    <label className="mv-rice-field">
                        <span>Impact</span>
                        <Select
                            value={[String(task.impact)]}
                            onUpdate={([impact]) => auto.save({impact: Number(impact)})}
                            options={[
                                {value: '1', content: '1 — низкий'},
                                {value: '2', content: '2 — средний'},
                                {value: '3', content: '3 — высокий'},
                            ]}
                            aria-label="Impact"
                        />
                        <small>Влияние на пользователя и продукт</small>
                    </label>
                    <label className="mv-rice-field">
                        <span>Confidence</span>
                        <TextInput
                            type="number"
                            controlProps={{min: 0, max: 100, step: 1}}
                            value={String(task.confidence)}
                            onUpdate={(value) => auto.save({confidence: Math.min(100, Math.max(0, Number(value) || 0))})}
                            aria-label="Confidence в процентах"
                            endContent={<span className="mv-rice-field__percent">%</span>}
                        />
                        <small>Уверенность в оценках, максимум 100%</small>
                    </label>
                </div>
            </section>

            <section className="mv-product-section">
                <div className="mv-product-section__head">
                    <div>
                        <Text variant="subheader-1">Оценка команды · Effort</Text>
                        <Text variant="caption-2" color="secondary">
                            Выберите роли для этой задачи и заполните их оценки
                        </Text>
                    </div>
                    <span className="mv-effort-total">Σ {numberFormat.format(effort)}</span>
                </div>
                <div className="mv-role-grid">
                    {PRODUCT_ROLE_IDS.map((id) => {
                        const enabled = selected(id);
                        const value = task.estimates[id];
                        return (
                            <div className={`mv-role-row${enabled ? ' mv-role-row_selected' : ''}`} key={id}>
                                <Checkbox
                                    checked={enabled}
                                    onUpdate={(checked) => setRole(id, checked)}
                                    content={PRODUCT_ROLES[id]}
                                    aria-label={`Выбрать роль ${PRODUCT_ROLES[id]}`}
                                />
                                <TextInput
                                    type="number"
                                    controlProps={{min: 0, step: 0.5}}
                                    value={enabled && value != null ? String(value) : ''}
                                    onUpdate={(next) => setEstimate(id, next)}
                                    disabled={!enabled}
                                    placeholder="Оценка"
                                    aria-label={`Оценка: ${PRODUCT_ROLES[id]}`}
                                />
                            </div>
                        );
                    })}
                </div>
                <Text variant="caption-2" color="secondary">
                    Effort — сумма заполненных оценок. Если роли не выбраны или оценки не заполнены, в формуле используется 1.
                </Text>
            </section>
        </div>
    );
}
