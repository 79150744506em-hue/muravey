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

const statusOptions = (Object.keys(PRODUCT_STATUSES) as ProductTaskStatus[]).map((value) => ({
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

    const sorted = [...p.products].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const create = () => {
        const name = title.trim();
        if (!name) return;
        const item: Product = {
            id: uid(),
            title: name,
            description: '',
            tasks: [],
            createdAt: new Date().toISOString(),
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
                <ul className="mv-products__grid">
                    {sorted.map((item) => {
                        const active = item.tasks.filter((task) => task.status !== 'archive').length;
                        const leader = [...item.tasks].sort((a, b) => riceScore(b) - riceScore(a))[0];
                        return (
                            <li key={item.id}>
                                <button type="button" className="mv-product-card" onClick={() => p.onOpenProduct(item.id)}>
                                    <span className="mv-product-card__icon"><Icon data={Cube} size={22} /></span>
                                    <span className="mv-product-card__title">{item.title}</span>
                                    <span className="mv-product-card__description">
                                        {item.description?.trim() || 'Бэклог продукта и приоритизация фич'}
                                    </span>
                                    <span className="mv-product-card__stats">
                                        <span><strong>{featuresWord(item.tasks.length)}</strong></span>
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
                            </li>
                        );
                    })}
                </ul>
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

function ProductPage({product, ...p}: ProductsProps & {product: Product}) {
    const [title, setTitle] = React.useState(product.title);
    const [openTaskId, setOpenTaskId] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState<ProductTask | null>(null);
    const [statusFilter, setStatusFilter] = React.useState('all');
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

    const storedCard = product.tasks.find((task) => task.id === openTaskId) ?? null;
    const cardTask = storedCard ?? (draft?.id === openTaskId ? draft : null);
    const sorted = [...product.tasks].sort((a, b) => riceScore(b) - riceScore(a) || b.createdAt.localeCompare(a.createdAt));
    const visible = statusFilter === 'all' ? sorted : sorted.filter((task) => task.status === statusFilter);
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
                        <Select
                            value={[statusFilter]}
                            onUpdate={([value]) => setStatusFilter(value)}
                            options={[{value: 'all', content: 'Все статусы'}, ...statusOptions]}
                            aria-label="Фильтр по статусу"
                            width={170}
                        />
                        <Button view="action" onClick={addTask} disabled={p.disabled}>
                            <Icon data={Plus} size={16} />
                            Добавить задачу
                        </Button>
                    </div>
                </div>

                {visible.length > 0 ? (
                    <div className="mv-product-table-wrap">
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
                            <tbody>
                                {visible.map((task) => {
                                    const rank = sorted.indexOf(task) + 1;
                                    return (
                                        <tr key={task.id}>
                                            <td className="mv-product-table__rank" data-label="Приоритет">{rank}</td>
                                            <td className="mv-product-table__feature" data-label="Название фичи">
                                                <button type="button" onClick={() => setOpenTaskId(task.id)}>
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
                                                <button type="button" onClick={() => setOpenTaskId(task.id)} aria-label={`Открыть задачу ${task.title}`}>
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
                                                            action: () => duplicateTask(task),
                                                        },
                                                        {
                                                            text: 'Удалить',
                                                            theme: 'danger',
                                                            iconStart: <Icon data={TrashBin} size={16} />,
                                                            action: () => removeTask(task),
                                                        },
                                                    ]}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="mv-product-backlog__empty">
                        <span className="mv-product-backlog__empty-icon"><Icon data={ChartLine} size={24} /></span>
                        <Text variant="subheader-1">
                            {product.tasks.length ? 'Нет задач с выбранным статусом' : 'Добавьте первую фичу'}
                        </Text>
                        <Text color="secondary">
                            {product.tasks.length
                                ? 'Выберите другой статус, чтобы увидеть задачи.'
                                : 'Заполните RICE-параметры и оценки команды — таблица сама построит приоритеты.'}
                        </Text>
                        {!product.tasks.length && (
                            <Button view="outlined" onClick={addTask} disabled={p.disabled}>
                                <Icon data={Plus} size={16} />
                                Создать задачу
                            </Button>
                        )}
                    </div>
                )}
                {visible.length > 0 && (
                    <div className="mv-product-backlog__foot">
                        <Text variant="caption-2" color="secondary">
                            RICE = Reach × Impact × Confidence ÷ Effort · сортировка от большего к меньшему
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
