import React from 'react';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type {DragEndEvent, DragStartEvent} from '@dnd-kit/core';
import {Icon, Text} from '@gravity-ui/uikit';
import {Grip, Sun, Tray} from '@gravity-ui/icons';

import {TagLabels} from './App';
import type {Tag, Task} from './types';

type Col = 'backlog' | 'today';

export function PlanBoard({
    backlog,
    today,
    tagMap,
    onPlan,
    onUnplan,
}: {
    backlog: Task[];
    today: Task[];
    tagMap: Map<string, Tag>;
    onPlan: (id: string) => void;
    onUnplan: (id: string) => void;
}) {
    const sensors = useSensors(
        useSensor(MouseSensor, {activationConstraint: {distance: 4}}),
        useSensor(TouchSensor, {activationConstraint: {delay: 150, tolerance: 6}}),
        useSensor(KeyboardSensor),
    );
    const [active, setActive] = React.useState<Task | null>(null);

    const onStart = (e: DragStartEvent) => {
        const id = String(e.active.id);
        setActive([...backlog, ...today].find((t) => t.id === id) ?? null);
    };
    const onEnd = (e: DragEndEvent) => {
        setActive(null);
        const from = e.active.data.current?.col as Col | undefined;
        const to = e.over?.id as Col | undefined;
        if (!to || from === to) return;
        const id = String(e.active.id);
        if (to === 'today') onPlan(id);
        else onUnplan(id);
    };

    return (
        <DndContext
            sensors={sensors}
            onDragStart={onStart}
            onDragEnd={onEnd}
            onDragCancel={() => setActive(null)}
            accessibility={{
                screenReaderInstructions: {
                    draggable: 'Пробел, чтобы взять задачу, стрелки, чтобы перенести, пробел, чтобы отпустить.',
                },
            }}
        >
            <div className="mv-board">
                <Column col="backlog" title="Бэклог" icon={Tray} tasks={backlog} tagMap={tagMap} empty="Бэклог пуст." />
                <Column
                    col="today"
                    title="Сегодня"
                    icon={Sun}
                    tasks={today}
                    tagMap={tagMap}
                    empty="Перетащите сюда задачи на сегодня."
                />
            </div>
            <DragOverlay dropAnimation={{duration: 180, easing: 'ease-out'}}>
                {active ? <CardBody task={active} tagMap={tagMap} overlay /> : null}
            </DragOverlay>
        </DndContext>
    );
}

function Column({
    col,
    title,
    icon,
    tasks,
    tagMap,
    empty,
}: {
    col: Col;
    title: string;
    icon: typeof Tray;
    tasks: Task[];
    tagMap: Map<string, Tag>;
    empty: string;
}) {
    const {setNodeRef, isOver, active} = useDroppable({id: col});
    const fromOther = active && active.data.current?.col !== col;
    return (
        <section
            ref={setNodeRef}
            className={`mv-col${isOver && fromOther ? ' mv-col_over' : ''}${fromOther ? ' mv-col_target' : ''}`}
            aria-label={title}
        >
            <header className="mv-col__head">
                <Icon data={icon} size={16} />
                <Text variant="subheader-2">{title}</Text>
                <Text color="secondary" className="mv-col__count">
                    {tasks.length}
                </Text>
            </header>
            {tasks.length === 0 ? (
                <div className="mv-col__empty">
                    <Text color="secondary">{empty}</Text>
                </div>
            ) : (
                <ul className="mv-col__list">
                    {tasks.map((t) => (
                        <DraggableCard key={t.id} task={t} col={col} tagMap={tagMap} />
                    ))}
                </ul>
            )}
        </section>
    );
}

function DraggableCard({task, col, tagMap}: {task: Task; col: Col; tagMap: Map<string, Tag>}) {
    const {attributes, listeners, setNodeRef, isDragging} = useDraggable({id: task.id, data: {col}});
    return (
        <li
            ref={setNodeRef}
            className={`mv-card${isDragging ? ' mv-card_ghost' : ''}`}
            {...attributes}
            {...listeners}
            aria-roledescription="перетаскиваемая задача"
        >
            <CardBody task={task} tagMap={tagMap} />
        </li>
    );
}

function CardBody({task, tagMap, overlay}: {task: Task; tagMap: Map<string, Tag>; overlay?: boolean}) {
    return (
        <div className={`mv-card__body${overlay ? ' mv-card__body_overlay' : ''}`}>
            <Icon data={Grip} size={14} className="mv-card__grip" />
            <div className="mv-card__main">
                <span className="mv-card__title">{task.title}</span>
                {task.tagIds.length > 0 && (
                    <span className="mv-row__meta">
                        <TagLabels ids={task.tagIds} tagMap={tagMap} />
                    </span>
                )}
            </div>
        </div>
    );
}
