import React from 'react';
import {Button, Icon} from '@gravity-ui/uikit';
import {Plus} from '@gravity-ui/icons';

export function AddListItem({
    children,
    onClick,
    disabled = false,
    className = '',
}: {
    children: string;
    onClick: () => void;
    disabled?: boolean;
    className?: string;
}) {
    return (
        <Button
            view="flat-secondary"
            size="l"
            className={`mv-list-add ${className}`.trim()}
            onClick={onClick}
            disabled={disabled}
        >
            <Icon data={Plus} size={16} />
            {children}
        </Button>
    );
}
