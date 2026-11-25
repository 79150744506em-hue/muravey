import React from 'react';
import {Alert, Button, Dialog, Icon, Label, Select, Text, TextInput} from '@gravity-ui/uikit';
import {Person, PersonPlus, TrashBin} from '@gravity-ui/icons';
import type {Backend} from './store';
import type {EntityDocument, EntityKind, SharedAccess} from './types';

export const ACCESS_NAMES = {owner: 'Владелец', edit: 'Редактирование', view: 'Просмотр'} as const;
export const ENTITY_NAMES = {product: 'продукт', roadmap: 'дорожную карту', stakeholderMap: 'карту стейкхолдеров'} as const;

function errorMessage(error: {code?: string}) {
    switch (error.code) {
        case 'user_not_found':
            return 'Пользователь с такой почтой ещё не зарегистрирован в Муравее.';
        case 'cannot_share_with_self':
            return 'Это ваш документ — вы уже его владелец.';
        case 'owner_only':
            return 'Управлять доступом может только владелец.';
        case 'read_only':
            return 'У вас доступ только на просмотр.';
        case 'access_denied':
            return 'Доступ к документу закрыт.';
        case 'connection_lost':
            return 'Нет соединения. Проверьте интернет и повторите.';
        default:
            return 'Не получилось изменить доступ. Попробуйте ещё раз.';
    }
}

export function AccessBadge({document}: {document?: EntityDocument}) {
    if (!document) return null;
    return (
        <Label theme={document.access === 'view' ? 'normal' : 'info'} size="s" icon={<Icon data={Person} size={12} />}>
            {document.access === 'owner'
                ? 'Вы владелец'
                : `${ACCESS_NAMES[document.access]} · владелец ${document.ownerEmail || 'пользователь'}`}
        </Label>
    );
}

export function ShareDialog({
    open,
    onClose,
    kind,
    id,
    title,
    document,
    backend,
}: {
    open: boolean;
    onClose: () => void;
    kind: EntityKind;
    id: string;
    title: string;
    document?: EntityDocument;
    backend: Backend | null;
}) {
    const [email, setEmail] = React.useState('');
    const [access, setAccess] = React.useState<SharedAccess>('view');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const owner = document?.access === 'owner';

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (cause) {
            setError(errorMessage(cause as {code?: string}));
        } finally {
            setBusy(false);
        }
    };
    const invite = () => {
        const value = email.trim();
        if (!value || !document || !backend?.setEntityAccess) return;
        void run(async () => {
            await backend.setEntityAccess!(kind, id, document.ownerId, value, access);
            setEmail('');
        });
    };

    return (
        <Dialog open={open} onClose={onClose} size="s" aria-label={`Доступ: ${title}`}>
            <Dialog.Header caption="Совместная работа" />
            <Dialog.Body>
                <div className="mv-sharing">
                    <Text color="secondary">
                        {owner
                            ? `Пригласите пользователей по почте в ${ENTITY_NAMES[kind]} «${title}». Изменения синхронизируются в реальном времени.`
                            : `Владелец: ${document?.ownerEmail || 'пользователь'}. Ваш доступ: ${ACCESS_NAMES[document?.access ?? 'view'].toLowerCase()}.`}
                    </Text>
                    {error && <Alert theme="danger" message={error} onClose={() => setError(null)} />}
                    {owner && document && (
                        <div className="mv-sharing__invite">
                            <TextInput
                                type="email"
                                size="l"
                                value={email}
                                onUpdate={setEmail}
                                placeholder="Почта пользователя"
                                aria-label="Почта пользователя"
                                onKeyDown={(event) => event.key === 'Enter' && invite()}
                            />
                            <Select
                                value={[access]}
                                onUpdate={([value]) => setAccess(value as SharedAccess)}
                                options={[
                                    {value: 'view', content: 'Просмотр'},
                                    {value: 'edit', content: 'Редактирование'},
                                ]}
                                aria-label="Права доступа"
                            />
                            <Button
                                view="action"
                                size="l"
                                onClick={invite}
                                loading={busy}
                                disabled={!/\S+@\S+\.\S+/.test(email.trim())}
                            >
                                <Icon data={PersonPlus} size={16} />
                                Добавить
                            </Button>
                        </div>
                    )}
                    <section className="mv-sharing__people" aria-label="У кого есть доступ">
                        <Text variant="subheader-1">У кого есть доступ</Text>
                        <div className="mv-sharing__person">
                            <span className="mv-sharing__avatar"><Icon data={Person} size={16} /></span>
                            <span className="mv-sharing__identity">
                                <strong>{document?.ownerEmail || 'Владелец'}</strong>
                                <Text variant="caption-2" color="secondary">Владелец</Text>
                            </span>
                        </div>
                        {(document?.members ?? []).map((member) => (
                            <div className="mv-sharing__person" key={member.userId}>
                                <span className="mv-sharing__avatar">{member.email.slice(0, 1).toUpperCase()}</span>
                                <span className="mv-sharing__identity">
                                    <strong>{member.email}</strong>
                                    <Text variant="caption-2" color="secondary">
                                        {member.access === 'edit' ? 'Может редактировать' : 'Может просматривать'}
                                    </Text>
                                </span>
                                {owner ? (
                                    <>
                                        <Select
                                            value={[member.access]}
                                            onUpdate={([value]) =>
                                                void run(() =>
                                                    backend!.setEntityAccess!(
                                                        kind,
                                                        id,
                                                        document!.ownerId,
                                                        member.email,
                                                        value as SharedAccess,
                                                    ),
                                                )
                                            }
                                            options={[
                                                {value: 'view', content: 'Просмотр'},
                                                {value: 'edit', content: 'Редактирование'},
                                            ]}
                                            disabled={busy}
                                            aria-label={`Доступ для ${member.email}`}
                                        />
                                        <Button
                                            view="flat-danger"
                                            size="m"
                                            disabled={busy}
                                            onClick={() =>
                                                void run(() =>
                                                    backend!.removeEntityAccess!(kind, id, document!.ownerId, member.userId),
                                                )
                                            }
                                            aria-label={`Удалить доступ для ${member.email}`}
                                            title="Удалить доступ"
                                        >
                                            <Icon data={TrashBin} size={16} />
                                        </Button>
                                    </>
                                ) : (
                                    <Label size="s" theme="normal">{ACCESS_NAMES[member.access]}</Label>
                                )}
                            </div>
                        ))}
                    </section>
                    {!owner && document && backend?.leaveEntity && (
                        <Button
                            view="outlined-danger"
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    await backend.leaveEntity!(kind, id, document.ownerId);
                                    onClose();
                                })
                            }
                        >
                            Убрать документ из моего списка
                        </Button>
                    )}
                </div>
            </Dialog.Body>
            <Dialog.Footer textButtonCancel="Закрыть" onClickButtonCancel={onClose} />
        </Dialog>
    );
}
