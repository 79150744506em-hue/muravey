import React from 'react';
import {Button, Icon, Popup} from '@gravity-ui/uikit';
import {Calendar, ChevronDown, ChevronLeft, ChevronRight} from '@gravity-ui/icons';

import {addDays, dayKey} from './types';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const fmtValue = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'});
const fmtMonth = new Intl.DateTimeFormat('ru-RU', {month: 'long', year: 'numeric'});
const asDate = (day: string) => new Date(day + 'T12:00:00');
const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && dayKey(asDate(day)) === day;

export function DateField({
    id,
    value,
    onChange,
    min,
    max,
    disabled,
    className = '',
    placeholder = 'Выбрать дату',
    ariaLabel = 'Выбрать дату',
}: {
    id?: string;
    value: string;
    onChange: (day: string) => void;
    min?: string;
    max?: string;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
    ariaLabel?: string;
}) {
    const anchorRef = React.useRef<HTMLDivElement>(null);
    const dayRefs = React.useRef(new Map<string, HTMLButtonElement>());
    const today = dayKey();
    const [open, setOpen] = React.useState(false);
    const initial = isDay(value) ? value : min && today < min ? min : max && today > max ? max : today;
    const [month, setMonth] = React.useState(initial.slice(0, 7));
    const [activeDay, setActiveDay] = React.useState(initial);
    const allowed = React.useCallback((day: string) => (!min || day >= min) && (!max || day <= max), [min, max]);

    const show = () => {
        const day = isDay(value) ? value : min && today < min ? min : max && today > max ? max : today;
        setMonth(day.slice(0, 7));
        setActiveDay(day);
        setOpen(true);
    };
    const choose = (day: string) => {
        if (!allowed(day)) return;
        onChange(day);
        setOpen(false);
    };
    const shiftMonth = (amount: number) => {
        const date = asDate(month + '-01');
        date.setMonth(date.getMonth() + amount);
        const nextMonth = dayKey(date).slice(0, 7);
        let nextActive = nextMonth + '-01';
        if (min?.slice(0, 7) === nextMonth) nextActive = min;
        else if (max?.slice(0, 7) === nextMonth) nextActive = max;
        setMonth(nextMonth);
        setActiveDay(nextActive);
    };

    React.useEffect(() => {
        if (!open) return;
        const frame = window.requestAnimationFrame(() => dayRefs.current.get(activeDay)?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [open, activeDay, month]);

    const moveFocus = (day: string) => {
        if (!allowed(day)) return;
        setActiveDay(day);
        setMonth(day.slice(0, 7));
    };
    const onDayKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, day: string) => {
        const moves: Partial<Record<string, number>> = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7};
        if (event.key in moves) {
            event.preventDefault();
            moveFocus(addDays(day, moves[event.key]!));
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const weekday = (asDate(day).getDay() + 6) % 7;
            moveFocus(addDays(day, event.key === 'Home' ? -weekday : 6 - weekday));
        } else if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            const date = asDate(day);
            date.setMonth(date.getMonth() + (event.key === 'PageUp' ? -1 : 1));
            moveFocus(dayKey(date));
        }
    };

    const first = asDate(month + '-01');
    const offset = (first.getDay() + 6) % 7;
    const gridStart = addDays(dayKey(first), -offset);
    const days = Array.from({length: 42}, (_, index) => addDays(gridStart, index));

    return (
        <div ref={anchorRef} className={`mv-date-field__picker ${className}`.trim()}>
            <button
                id={id}
                type="button"
                className={`mv-date-field__control${value ? ' mv-date-field__control_filled' : ''}`}
                aria-label={ariaLabel}
                aria-haspopup="dialog"
                aria-expanded={open}
                disabled={disabled}
                onClick={() => (open ? setOpen(false) : show())}
            >
                <Icon data={Calendar} size={16} className="mv-date-field__calendar" />
                <span>{isDay(value) ? fmtValue.format(asDate(value)).replace(/\s*г\.$/, '') : placeholder}</span>
                <Icon data={ChevronDown} size={14} className="mv-date-field__chevron" />
            </button>
            <Popup
                open={open}
                anchorRef={anchorRef}
                placement="bottom-start"
                offset={6}
                initialFocus={-1}
                onOpenChange={setOpen}
                role="dialog"
                aria-label={ariaLabel}
            >
                <div className="mv-date-picker">
                    <div className="mv-date-picker__head">
                        <Button view="flat-secondary" size="s" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
                            <Icon data={ChevronLeft} size={16} />
                        </Button>
                        <span className="mv-date-picker__month" aria-live="polite">
                            {fmtMonth.format(first).replace(/\s*г\.$/, '')}
                        </span>
                        <Button view="flat-secondary" size="s" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
                            <Icon data={ChevronRight} size={16} />
                        </Button>
                    </div>
                    <div className="mv-date-picker__weekdays" aria-hidden="true">
                        {WEEKDAYS.map((day) => (
                            <span key={day}>{day}</span>
                        ))}
                    </div>
                    <div className="mv-date-picker__grid">
                        {days.map((day) => {
                            const selected = day === value;
                            const outside = day.slice(0, 7) !== month;
                            return (
                                <button
                                    key={day}
                                    ref={(node) => {
                                        if (node) dayRefs.current.set(day, node);
                                        else dayRefs.current.delete(day);
                                    }}
                                    type="button"
                                    className={`mv-date-picker__day${outside ? ' mv-date-picker__day_outside' : ''}${
                                        day === today ? ' mv-date-picker__day_today' : ''
                                    }${selected ? ' mv-date-picker__day_selected' : ''}`}
                                    aria-label={fmtValue.format(asDate(day))}
                                    aria-pressed={selected}
                                    tabIndex={day === activeDay ? 0 : -1}
                                    disabled={!allowed(day)}
                                    onClick={() => choose(day)}
                                    onKeyDown={(event) => onDayKeyDown(event, day)}
                                >
                                    {+day.slice(8, 10)}
                                </button>
                            );
                        })}
                    </div>
                    <div className="mv-date-picker__foot">
                        <Button view="flat-secondary" size="s" disabled={!allowed(today)} onClick={() => choose(today)}>
                            Сегодня
                        </Button>
                        {value && <span>{fmtValue.format(asDate(value)).replace(/\s*г\.$/, '')}</span>}
                    </div>
                </div>
            </Popup>
        </div>
    );
}
