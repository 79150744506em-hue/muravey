import React from 'react';
import {Icon, Text} from '@gravity-ui/uikit';
import {CircleCheck} from '@gravity-ui/icons';

const fmtTime = new Intl.DateTimeFormat('ru-RU', {hour: '2-digit', minute: '2-digit'});

export type SaveState = {kind: 'idle'} | {kind: 'pending'} | {kind: 'saved'; at: Date} | {kind: 'failed'};

/** Состояние последней записи в шапке карточки; пока ничего не меняли — подпись idle. */
export function SaveStatus({state, idle}: {state: SaveState; idle: string}) {
    if (state.kind === 'pending') {
        return (
            <Text variant="caption-2" color="secondary" aria-live="polite">
                Сохраняю…
            </Text>
        );
    }
    if (state.kind === 'saved') {
        return (
            <Text variant="caption-2" color="secondary" className="mv-saved" aria-live="polite">
                <Icon data={CircleCheck} size={12} />
                Изменения сохранены в {fmtTime.format(state.at)}
            </Text>
        );
    }
    if (state.kind === 'failed') {
        return (
            <Text variant="caption-2" color="danger" aria-live="polite">
                Не сохранено
            </Text>
        );
    }
    return (
        <Text variant="caption-2" color="secondary">
            {idle}
        </Text>
    );
}

/**
 * Автосохранение как в карточке задачи: save пишет сразу, schedule — после паузы в наборе текста,
 * а при закрытии карточки недописанное сохраняется.
 */
export function useAutosave<T>(commit: (p: Partial<T>) => Promise<void> | null) {
    const [state, setState] = React.useState<SaveState>({kind: 'idle'});
    const seq = React.useRef(0);
    const commitRef = React.useRef(commit);
    commitRef.current = commit;
    const save = React.useCallback((p: Partial<T>) => {
        const n = ++seq.current;
        const pr = commitRef.current(p);
        if (!pr) return setState({kind: 'idle'});
        setState({kind: 'pending'});
        pr.then(
            () => n === seq.current && setState({kind: 'saved', at: new Date()}),
            () => n === seq.current && setState({kind: 'failed'}),
        );
    }, []);
    const timer = React.useRef<number>();
    const pending = React.useRef<Partial<T>>({});
    const flush = React.useCallback(() => {
        window.clearTimeout(timer.current);
        const p = pending.current;
        pending.current = {};
        if (Object.keys(p).length) save(p);
    }, [save]);
    const schedule = (p: Partial<T>) => {
        setState({kind: 'pending'});
        pending.current = {...pending.current, ...p};
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, 700);
    };
    const flushRef = React.useRef(flush);
    flushRef.current = flush;
    React.useEffect(() => () => flushRef.current(), []);
    return {state, save, schedule, flush};
}
