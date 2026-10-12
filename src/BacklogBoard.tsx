import React from 'react';
import {
    DndContext,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCorners,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type {DragEndEvent, DragOverEvent} from '@dnd-kit/core';
import {SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy} from '@dnd-kit/sortable';
import {Icon, Text} from '@gravity-ui/uikit';
import {Sun, Tray} from '@gravity-ui/icons';

import type {Task} from './types';

export type Col = 'backlog' | 'today';
type Items = Record<Col, string[]>;

const COL_PREFIX = 'col:';

/**
 * Две колонки — сегодня (слева) и бэклог. Задачу можно перетащить внутри колонки (порядок)
 * или в соседнюю колонку на нужное место (запланировать / вернуть в бэклог).
 */
export function BacklogBoard({
    backlog,
    today,
    renderRow,
    onPlace,
    emptyBacklog,
}: {
    backlog: Task[];
    today: Task[];
    renderRow: (t: Task) => React.ReactNode;
    /** задача оказалась в колонке col на позиции index; ids — итоговый порядок колонки */
    onPlace: (id: string, col: Col, ids: string[], index: number) => void;
    emptyBacklog: string;
}) {
    const sensors = useSensors(
        useSensor(MouseSensor, {activationConstraint: {distance: 5}}),
        useSensor(TouchSensor, {activationConstraint: {delay: 200, tolerance: 6}}),
        useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}),
    );
    const byId = React.useMemo(() => new Map([...backlog, ...today].map((t) => [t.id, t])), [backlog, today]);
    const fromProps: Items = {backlog: backlog.map((t) => t.id), today: today.map((t) => t.id)};
    // во время перетаскивания держим свою раскладку, чтобы карточка «переезжала» между колонками
    const [drag, setDrag] = React.useState<Items | null>(null);
    const items = drag ?? fromProps;

    const colOf = (id: string, it: Items): Col | null => {
        if (id.startsWith(COL_PREFIX)) return id.slice(COL_PREFIX.length) as Col;
        if (it.backlog.includes(id)) return 'backlog';
        if (it.today.includes(id)) return 'today';
        return null;
    };

    const onOver = ({active, over}: DragOverEvent) => {
        if (!over) return;
        setDrag((cur) => {
            const it = cur ?? fromProps;
            const id = String(active.id);
            const from = colOf(id, it);
            const to = colOf(String(over.id), it);
            if (!from || !to || from === to) return it;
            const target = it[to].filter((x) => x !== id);
            const overIdx = target.indexOf(String(over.id));
            const at = overIdx >= 0 ? overIdx : target.length;
            target.splice(at, 0, id);
            return {...it, [from]: it[from].filter((x) => x !== id), [to]: target};
        });
    };

    const onEnd = ({active, over}: DragEndEvent) => {
        const it = drag ?? fromProps;
        setDrag(null);
        if (!over) return;
        const id = String(active.id);
        const col = colOf(id, it);
        if (!col) return;
        let ids = it[col];
        const overId = String(over.id);
        if (!overId.startsWith(COL_PREFIX) && overId !== id && ids.includes(overId)) {
            ids = arrayMove(ids, ids.indexOf(id), ids.indexOf(overId));
        }
        const index = ids.indexOf(id);
        const origCol: Col = fromProps.today.includes(id) ? 'today' : 'backlog';
        const origIndex = fromProps[origCol].indexOf(id);
        if (col === origCol && index === origIndex) return;
        onPlace(id, col, ids, index);
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={() => setDrag(fromProps)}
            onDragOver={onOver}
            onDragEnd={onEnd}
            onDragCancel={() => setDrag(null)}
            accessibility={{
                screenReaderInstructions: {
                    draggable:
                        'Пробел, чтобы взять задачу, стрелки, чтобы передвинуть или перенести в другую колонку, пробел, чтобы отпустить.',
                },
            }}
        >
            <div className="mv-board">
                <Column
                    col="today"
                    title="Сегодня"
                    icon={Sun}
                    ids={items.today}
                    byId={byId}
                    renderRow={renderRow}
                    empty="Перетащите сюда задачи на сегодня."
                />
                <Column col="backlog" title="Бэклог" icon={Tray} ids={items.backlog} byId={byId} renderRow={renderRow} empty={emptyBacklog} />
            </div>
        </DndContext>
    );
}

function Column({
    col,
    title,
    icon,
    ids,
    byId,
    renderRow,
    empty,
}: {
    col: Col;
    title: string;
    icon: typeof Tray;
    ids: string[];
    byId: Map<string, Task>;
    renderRow: (t: Task) => React.ReactNode;
    empty: string;
}) {
    const {setNodeRef, isOver} = useDroppable({id: COL_PREFIX + col});
    return (
        <section ref={setNodeRef} className={`mv-col${isOver ? ' mv-col_over' : ''}`} aria-label={title}>
            <header className="mv-col__head">
                <Icon data={icon} size={16} />
                <Text variant="subheader-2">{title}</Text>
                <Text color="secondary" className="mv-col__count">
                    {ids.length}
                </Text>
            </header>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {ids.length === 0 ? (
                    <div className="mv-col__empty">
                        <Text color="secondary">{empty}</Text>
                    </div>
                ) : (
                    <ul className="mv-list mv-col__rows">
                        {ids.map((id) => {
                            const t = byId.get(id);
                            return t ? <React.Fragment key={id}>{renderRow(t)}</React.Fragment> : null;
                        })}
                    </ul>
                )}
            </SortableContext>
        </section>
    );
}
