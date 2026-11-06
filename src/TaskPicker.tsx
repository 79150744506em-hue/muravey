import React from 'react';
import {Button, Icon, Label, Select, Text} from '@gravity-ui/uikit';
import {Calendar, CircleCheck, Link, Plus, Sun, Target, Tray} from '@gravity-ui/icons';

import {dayKey, effectiveList} from './types';
import type {ListKind, Tag, Task} from './types';

const LIST_NAMES: Record<ListKind, string> = {today: 'Сегодня', focus: 'Фокус', backlog: 'Бэклог'};
const LIST_ICONS = {today: Sun, focus: Target, backlog: Tray};
const fmtDue = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short'});

function TaskOption({task, tagMap}: {task: Task; tagMap: Map<string, Tag>}) {
    const list = effectiveList(task, dayKey());
    const tags = task.tagIds.map((id) => tagMap.get(id)).filter(Boolean) as Tag[];
    const ListIcon = task.done ? CircleCheck : LIST_ICONS[list];
    return (
        <span className={`mv-task-option${task.done ? ' mv-task-option_done' : ''}`}>
            <span className={`mv-task-option__icon mv-task-option__icon_${task.done ? 'done' : list}`} aria-hidden="true">
                <Icon data={ListIcon} size={16} />
            </span>
            <span className="mv-task-option__body">
                <span className="mv-task-option__title">{task.title}</span>
                <span className="mv-task-option__meta">
                    <span>{task.done ? 'Выполнена' : LIST_NAMES[list]}</span>
                    {task.dueDate && !task.done && (
                        <span className="mv-task-option__due">
                            <Icon data={Calendar} size={12} />
                            {fmtDue.format(new Date(task.dueDate + 'T12:00:00'))}
                        </span>
                    )}
                </span>
                {tags.length > 0 && (
                    <span className="mv-task-option__tags">
                        {tags.map((tag) => (
                            <Label key={tag.id} theme={tag.theme} size="xs">
                                {tag.name}
                            </Label>
                        ))}
                    </span>
                )}
            </span>
            <Icon data={Plus} size={16} className="mv-task-option__add" />
        </span>
    );
}

export function TaskPicker({
    id,
    label,
    icon,
    tasks,
    tags,
    onPick,
}: {
    id?: string;
    label: string;
    icon: typeof Link;
    tasks: Task[];
    tags: Tag[];
    onPick: (id: string) => void;
}) {
    const tagMap = React.useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
    return (
        <Select<Task>
            id={id}
            value={[]}
            filterable={tasks.length > 5}
            filterPlaceholder="Название или тег"
            popupWidth={420}
            popupClassName="mv-task-picker__popup"
            virtualizationThreshold={tasks.length + 1}
            onUpdate={([value]) => value && onPick(value)}
            options={tasks.map((task) => ({
                value: task.id,
                text: [task.title, ...task.tagIds.map((id) => tagMap.get(id)?.name ?? '')].join(' '),
                data: task,
            }))}
            filterOption={(option, filter) => (option.text ?? '').toLocaleLowerCase('ru').includes(filter.toLocaleLowerCase('ru'))}
            renderOption={(option) => <TaskOption task={option.data!} tagMap={tagMap} />}
            renderEmptyOptions={() => (
                <Text color="secondary" className="mv-task-picker__empty">
                    Ничего не нашлось. Попробуйте другое название или тег.
                </Text>
            )}
            renderControl={({ref, triggerProps}) => (
                <Button ref={ref as React.Ref<HTMLButtonElement>} {...triggerProps} view="outlined" size="m">
                    <Icon data={icon} size={16} />
                    {label}
                </Button>
            )}
        />
    );
}
