import React from 'react';
import {Alert, Button, Dialog, Icon, Label, Text} from '@gravity-ui/uikit';
import {BarsUnaligned, Bell, BellSlash, CircleCheck, Cube, Persons} from '@gravity-ui/icons';
import type {Backend} from './store';
import type {AppNotification, CollaborationState} from './types';
import {ACCESS_NAMES} from './Sharing';

const fmt = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const KIND_ICONS = {product: Cube, roadmap: BarsUnaligned, stakeholderMap: Persons} as const;
const ENTITY_NOTIFICATION_NAMES = {product: 'продукту', roadmap: 'дорожной карте', stakeholderMap: 'карте стейкхолдеров'} as const;

function pushKeyToBytes(value: string) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export function NotificationCenter({
    collaboration,
    backend,
    onOpen,
}: {
    collaboration: CollaborationState;
    backend: Backend | null;
    onOpen: (notification: AppNotification) => void;
}) {
    const [open, setOpen] = React.useState(false);
    const [pushEnabled, setPushEnabled] = React.useState(false);
    const [pushBusy, setPushBusy] = React.useState(false);
    const [pushError, setPushError] = React.useState<string | null>(null);
    const unread = collaboration.notifications.filter((item) => !item.readAt).length;

    React.useEffect(() => {
        if (!('serviceWorker' in navigator) || !collaboration.pushAvailable) return;
        navigator.serviceWorker
            .getRegistration('/sw.js')
            .then((registration) => registration?.pushManager.getSubscription())
            .then((subscription) => setPushEnabled(Boolean(subscription)))
            .catch(() => {});
    }, [collaboration.pushAvailable, open]);

    const togglePush = async () => {
        if (!backend?.subscribePush || !collaboration.pushPublicKey) return;
        setPushBusy(true);
        setPushError(null);
        try {
            if (pushEnabled) {
                const registration = await navigator.serviceWorker.getRegistration('/sw.js');
                const subscription = await registration?.pushManager.getSubscription();
                if (subscription) {
                    await backend.unsubscribePush?.(subscription.endpoint);
                    await subscription.unsubscribe();
                }
                setPushEnabled(false);
                return;
            }
            if (!('Notification' in window) || !('serviceWorker' in navigator)) {
                throw new Error('Браузер не поддерживает push-уведомления.');
            }
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('Браузер не разрешил уведомления. Их можно включить в настройках сайта.');
            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: pushKeyToBytes(collaboration.pushPublicKey),
            });
            await backend.subscribePush(subscription.toJSON());
            setPushEnabled(true);
        } catch (error) {
            setPushError(error instanceof Error ? error.message : 'Не получилось настроить push-уведомления.');
        } finally {
            setPushBusy(false);
        }
    };

    const markAll = () => unread > 0 && backend?.markNotificationsRead && void backend.markNotificationsRead().catch(() => {});
    const openNotification = (item: AppNotification) => {
        if (!item.readAt) void backend?.markNotificationsRead?.([item.id]).catch(() => {});
        setOpen(false);
        onOpen(item);
    };

    return (
        <>
            <Button
                view="outlined"
                size="m"
                className="mv-notifications-btn"
                onClick={() => setOpen(true)}
                aria-label={unread ? `Уведомления, непрочитанных ${unread}` : 'Уведомления'}
                title="Уведомления"
            >
                <Icon data={Bell} size={16} />
                {unread > 0 && <span className="mv-notifications-btn__badge">{unread > 99 ? '99+' : unread}</span>}
            </Button>
            <Dialog open={open} onClose={() => setOpen(false)} size="s" aria-label="Уведомления">
                <Dialog.Header caption="Уведомления" />
                <Dialog.Body>
                    <div className="mv-notifications">
                        {collaboration.pushAvailable && (
                            <section className="mv-notifications__push">
                                <div>
                                    <Text variant="subheader-1">Браузерные пуши</Text>
                                    <Text variant="caption-2" color="secondary">
                                        Придут, когда вам откроют доступ, даже если сайт закрыт.
                                    </Text>
                                </div>
                                <Button view={pushEnabled ? 'outlined' : 'action'} size="m" onClick={() => void togglePush()} loading={pushBusy}>
                                    <Icon data={pushEnabled ? BellSlash : Bell} size={16} />
                                    {pushEnabled ? 'Выключить' : 'Включить'}
                                </Button>
                            </section>
                        )}
                        {pushError && <Alert theme="danger" message={pushError} onClose={() => setPushError(null)} />}
                        {collaboration.notifications.length > 0 && (
                            <div className="mv-notifications__toolbar">
                                <Text variant="caption-2" color="secondary">
                                    {unread ? `Непрочитанных: ${unread}` : 'Все уведомления прочитаны'}
                                </Text>
                                {unread > 0 && (
                                    <Button view="flat-secondary" size="s" onClick={markAll}>
                                        <Icon data={CircleCheck} size={14} />
                                        Прочитать все
                                    </Button>
                                )}
                            </div>
                        )}
                        {collaboration.notifications.length === 0 ? (
                            <div className="mv-notifications__empty">
                                <Icon data={Bell} size={28} />
                                <Text color="secondary">Пока уведомлений нет. Здесь появятся приглашения к совместной работе.</Text>
                            </div>
                        ) : (
                            <ul className="mv-notifications__list">
                                {collaboration.notifications.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            className={`mv-notification${item.readAt ? '' : ' mv-notification_unread'}`}
                                            onClick={() => openNotification(item)}
                                        >
                                            <span className="mv-notification__icon"><Icon data={KIND_ICONS[item.kind]} size={18} /></span>
                                            <span className="mv-notification__body">
                                                <span className="mv-notification__title">
                                                    {item.ownerEmail || 'Пользователь'} открыл доступ к {ENTITY_NOTIFICATION_NAMES[item.kind]} «{item.title}»
                                                </span>
                                                <span className="mv-notification__meta">
                                                    <Label size="xs" theme={item.access === 'edit' ? 'info' : 'normal'}>
                                                        {ACCESS_NAMES[item.access]}
                                                    </Label>
                                                    {fmt.format(new Date(item.createdAt))}
                                                </span>
                                            </span>
                                            {!item.readAt && <span className="mv-notification__dot" aria-label="Непрочитано" />}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </Dialog.Body>
                <Dialog.Footer textButtonCancel="Закрыть" onClickButtonCancel={() => setOpen(false)} />
            </Dialog>
        </>
    );
}
