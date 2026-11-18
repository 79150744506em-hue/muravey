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
                    <h2 className="mv-release__title">Муравей стал надёжнее</h2>
                    <p className="mv-release__lead">
                        Это обновление — про спокойствие: задачи под защитой, а связь восстанавливается сама.
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
                                Появились автоматические копии данных. Если что-то удалили случайно, откройте «Ещё» →
                                «Автоматические копии» и верните одну из последних 20 версий.
                            </li>
                            <li>При новых версиях будем коротко рассказывать о главном в таком окне.</li>
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
                                Муравей сам проверяет соединение при возвращении во вкладку. Когда связь восстановлена,
                                индикатор исчезает — перезагружать страницу не нужно.
                            </li>
                        </ul>
                    </section>

                    <p className="mv-release__signature">
                        Спасибо, что пользуетесь Муравьём, друзья. С уважением, Егор
                    </p>
                </div>
            </Dialog.Body>
            <Dialog.Footer textButtonApply="Понятно, спасибо" onClickButtonApply={close} />
        </Dialog>
    );
}
