import React from 'react';
import {Dialog, Icon} from '@gravity-ui/uikit';
import {CircleCheck, Plus} from '@gravity-ui/icons';
import logo from './assets/logo.png';

const SEEN_KEY = 'muravey:release-notes-seen';

export function ReleaseNotes({ready}: {ready: boolean}) {
    const [open, setOpen] = React.useState(false);

    React.useEffect(() => {
        if (!ready) return;
        let seen = false;
        try {
            seen = localStorage.getItem(SEEN_KEY) === __APP_VERSION__;
        } catch {
            /* без сохранения показа между запусками */
        }
        if (!seen) setOpen(true);
    }, [ready]);

    const close = () => {
        try {
            localStorage.setItem(SEEN_KEY, __APP_VERSION__);
        } catch {
            /* без сохранения показа между запусками */
        }
        setOpen(false);
    };

    if (!ready) return null;
    return (
        <Dialog
            open={open}
            onClose={close}
            size="s"
            modalClassName="mv-release-modal"
            contentOverflow="auto"
            aria-label={`Что нового в Муравье, версия ${__APP_VERSION__}`}
        >
            <Dialog.Body>
                <div className="mv-release">
                    <div className="mv-release__top">
                        <img src={logo} alt="" className="mv-release__logo" />
                        <span className="mv-release__version">Версия {__APP_VERSION__}</span>
                    </div>
                    <span className="mv-release__eyebrow">ЧТО НОВОГО</span>
                    <h2 className="mv-release__title">Roadmap стал удобнее</h2>
                    <p className="mv-release__lead">
                        Выстраивайте эпики в нужном порядке и работайте с картой на всю ширину экрана.
                    </p>

                    <section className="mv-release__section">
                        <h3>
                            <span className="mv-release__section-icon mv-release__section-icon_added">
                                <Icon data={Plus} size={15} />
                            </span>
                            Добавлено
                        </h3>
                        <ul>
                            <li>
                                Эпики теперь можно перетаскивать выше и ниже за значок ⋮⋮ вместе со своими вехами. Порядок
                                сохраняется, а случайное перемещение можно отменить в уведомлении.
                            </li>
                        </ul>
                    </section>

                    <section className="mv-release__section">
                        <h3>
                            <span className="mv-release__section-icon mv-release__section-icon_fixed">
                                <Icon data={CircleCheck} size={15} />
                            </span>
                            Исправлено
                        </h3>
                        <ul>
                            <li>
                                Roadmap использует всю доступную ширину большого экрана. На небольшом экране названия эпиков
                                читаются лучше, а шкала времени прокручивается горизонтально.
                            </li>
                        </ul>
                    </section>

                    <p className="mv-release__signature">
                        Спасибо, что пользуетесь Муравьём, друзья.
                        <span className="mv-release__signature-name">С уважением, Егор</span>
                    </p>
                </div>
            </Dialog.Body>
            <Dialog.Footer textButtonApply="Понятно, спасибо" onClickButtonApply={close} />
        </Dialog>
    );
}
