import React from 'react';
import {DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors} from '@dnd-kit/core';
import type {DragEndEvent} from '@dnd-kit/core';
import {restrictToParentElement, restrictToVerticalAxis} from '@dnd-kit/modifiers';
import {SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';

/** Вертикальный список задач, который можно переупорядочить перетаскиванием. */
export function SortableList({
    ids,
    disabled,
    onMove,
    children,
}: {
    ids: string[];
    disabled?: boolean;
    onMove: (from: number, to: number) => void;
    children: React.ReactNode;
}) {
    const sensors = useSensors(
        useSensor(MouseSensor, {activationConstraint: {distance: 5}}),
        useSensor(TouchSensor, {activationConstraint: {delay: 200, tolerance: 6}}),
        useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}),
    );
    const onEnd = (e: DragEndEvent) => {
        if (!e.over) return;
        const from = ids.indexOf(String(e.active.id));
        const to = ids.indexOf(String(e.over.id));
        if (from >= 0 && to >= 0 && from !== to) onMove(from, to);
    };
    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onEnd}
            accessibility={{
                screenReaderInstructions: {
                    draggable: 'Пробел, чтобы взять задачу, стрелки вверх и вниз, чтобы передвинуть, пробел, чтобы отпустить.',
                },
            }}
        >
            <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
                <ul className="mv-list">{children}</ul>
            </SortableContext>
        </DndContext>
    );
}

/** Подключает строку к сортировке; клик сразу после перетаскивания не открывает карточку. */
export function useSortableRow(id: string, enabled: boolean) {
    const s = useSortable({id, disabled: !enabled});
    const wasDragging = React.useRef(false);
    const endedAt = React.useRef(0);
    React.useEffect(() => {
        if (s.isDragging) wasDragging.current = true;
        else if (wasDragging.current) {
            wasDragging.current = false;
            endedAt.current = Date.now();
        }
    }, [s.isDragging]);
    const consumeDrag = () => s.isDragging || Date.now() - endedAt.current < 300;
    return {
        ref: s.setNodeRef,
        props: enabled
            ? {
                  ...s.attributes,
                  ...s.listeners,
                  // клавиатурное перетаскивание только с самой строки, а не с кнопок внутри
                  onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.target === e.currentTarget) s.listeners?.onKeyDown?.(e);
                  },
                  'aria-roledescription': 'перетаскиваемая задача',
              }
            : {},
        style: {transform: CSS.Translate.toString(s.transform), transition: s.transition} as React.CSSProperties,
        isDragging: s.isDragging,
        consumeDrag,
    };
}
