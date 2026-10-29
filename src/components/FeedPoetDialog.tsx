'use client';

import { useEffect, useMemo, useState } from 'react';
import { Poet } from '@/types/poet';
import { FaRandom, FaSearch, FaTimes } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import { getPoetKey, getPoetDisplayName } from '@/utils/feedPoets';

const DEFAULT_FEED_GROUP = 'گنجور';
const FEED_GROUP_ORDER = [DEFAULT_FEED_GROUP, 'اکولالیا', 'شاعران محلی'] as const;

const sampleKeys = (keys: string[], count: number) => {
    const shuffled = [...keys];

    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, count);
};

export default function FeedPoetDialog({
    poets,
    selectedKeys,
    onSave,
    onClose,
}: {
    poets: Poet[];
    selectedKeys: string[];
    onSave: (keys: string[]) => void;
    onClose: () => void;
}) {
    const [pendingKeys, setPendingKeys] = useState<string[]>(selectedKeys);
    const [activeGroupName, setActiveGroupName] = useState(DEFAULT_FEED_GROUP);
    const [searchInput, setSearchInput] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const pendingKeySet = useMemo(() => new Set(pendingKeys), [pendingKeys]);

    useEffect(() => {
        setPendingKeys(selectedKeys);
    }, [selectedKeys]);

    const groupedPoets = useMemo(() => {
        return poets.reduce<Record<string, Poet[]>>((groups, poet) => {
            const groupName =
                poet.source === 'echolalia'
                    ? 'اکولالیا'
                    : poet.source === 'custom'
                        ? 'شاعران محلی'
                        : 'گنجور';
            groups[groupName] = groups[groupName] || [];
            groups[groupName].push(poet);
            return groups;
        }, {});
    }, [poets]);

    const groupNames = useMemo(() => {
        const availableGroupNames = Object.keys(groupedPoets);
        return [
            'همه',
            ...FEED_GROUP_ORDER.filter((groupName) => availableGroupNames.includes(groupName)),
        ];
    }, [groupedPoets]);

    const visiblePoets = useMemo(() => {
        const sourcePoets =
            activeGroupName === 'همه'
                ? poets
                : groupedPoets[activeGroupName] || [];
        const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase('fa');

        if (!normalizedSearchTerm) {
            return sourcePoets;
        }

        return sourcePoets.filter((poet) => {
            return [
                poet.name,
                poet.nickname || '',
                poet.urlSlug,
                poet.sourceGroupName || '',
            ].some((value) =>
                value.toLocaleLowerCase('fa').includes(normalizedSearchTerm),
            );
        });
    }, [activeGroupName, groupedPoets, poets, searchTerm]);

    const categoryGroups = useMemo(() => {
        return FEED_GROUP_ORDER
            .filter((groupName) => groupedPoets[groupName]?.length)
            .filter((groupName) => activeGroupName === 'همه' || activeGroupName === groupName)
            .map((groupName) => {
                const poetsInGroup = groupedPoets[groupName] || [];
                const selectedCount = poetsInGroup.reduce((count, poet) => (
                    count + (pendingKeySet.has(getPoetKey(poet)) ? 1 : 0)
                ), 0);

                return {
                    name: groupName,
                    poets: poetsInGroup,
                    selectedCount,
                };
            });
    }, [activeGroupName, groupedPoets, pendingKeySet]);

    const togglePoet = (key: string) => {
        setPendingKeys((currentKeys) =>
            currentKeys.includes(key)
                ? currentKeys.filter((currentKey) => currentKey !== key)
                : [...currentKeys, key],
        );
    };

    const applyRandomSelection = () => {
        const pool = visiblePoets.length > 0 ? visiblePoets : poets;
        const poolKeys = pool.map(getPoetKey);

        if (poolKeys.length === 0) {
            return;
        }

        const nextCount = Math.min(poolKeys.length, Math.max(4, Math.ceil(poolKeys.length / 4)));
        const sampledKeys = sampleKeys(poolKeys, nextCount);
        const poolKeySet = new Set(poolKeys);

        setPendingKeys((currentKeys) => [
            ...currentKeys.filter((key) => !poolKeySet.has(key)),
            ...sampledKeys,
        ]);
    };

    const selectGroup = (groupPoets: Poet[]) => {
        setPendingKeys((currentKeys) => (
            Array.from(new Set([...currentKeys, ...groupPoets.map(getPoetKey)]))
        ));
    };

    const clearGroup = (groupPoets: Poet[]) => {
        const groupKeySet = new Set(groupPoets.map(getPoetKey));
        setPendingKeys((currentKeys) => currentKeys.filter((key) => !groupKeySet.has(key)));
    };

    return (
        <Dialog
            open
            disablePointerDismissal
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogPopup dir="rtl" showCloseButton={false} className="text-right sm:max-w-3xl">
                <DialogHeader>
                    <div className="flex items-center justify-between gap-4">
                        <DialogTitle>شاعران مورد علاقه</DialogTitle>
                        <Button variant="ghost" size="icon" className="size-11" onClick={onClose} aria-label="بستن">
                            <FaTimes />
                        </Button>
                    </div>
                </DialogHeader>
                <DialogPanel className="grid gap-4">
                    <div className="feed-poet-summary">
                        <span><strong>{pendingKeys.length}</strong> شاعر انتخاب شده</span>
                        <span><strong>{visiblePoets.length}</strong> شاعر در این دسته</span>
                    </div>
                    <form
                        className="flex items-center gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            setSearchTerm(searchInput);
                        }}
                    >
                        <div className="relative flex-1">
                            <Input
                                value={searchInput}
                                onChange={(event) => setSearchInput(event.target.value)}
                                placeholder="جست‌وجوی شاعر"
                                className="pe-11"
                            />
                            <Button type="submit" variant="ghost" size="icon" className="absolute inset-y-0 end-0 h-11 w-11" aria-label="جست‌وجو">
                                <FaSearch />
                            </Button>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-11"
                            onClick={applyRandomSelection}
                            aria-label="انتخاب تصادفی"
                            title="انتخاب تصادفی"
                        >
                            <FaRandom />
                        </Button>
                    </form>
                    <Tabs value={activeGroupName} onValueChange={(value) => setActiveGroupName(value as string)}>
                        <TabsList className="flex overflow-x-auto [scrollbar-width:none]">
                            {groupNames.map((groupName) => (
                                <TabsTab key={groupName} value={groupName} className="flex-none">
                                    {groupName}
                                </TabsTab>
                            ))}
                        </TabsList>
                    </Tabs>
                    <div className="feed-poet-category-cards">
                        {categoryGroups.map((group) => (
                            <Card key={group.name} size="sm" className="flex-row items-center justify-between gap-2 px-3">
                                <div className="grid gap-0.5">
                                    <h3 className="text-sm font-bold">{group.name}</h3>
                                    <span className="text-xs text-muted-foreground">{group.selectedCount} از {group.poets.length}</span>
                                </div>
                                <div className="flex gap-1.5">
                                    <Button variant="outline" size="sm" onClick={() => selectGroup(group.poets)}>
                                        انتخاب همه
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => clearGroup(group.poets)}>
                                        پاک کردن
                                    </Button>
                                </div>
                            </Card>
                        ))}
                    </div>
                    <div className="interest-picker-grid">
                        {visiblePoets.map((poet) => {
                            const key = getPoetKey(poet);
                            return (
                                <Toggle
                                    key={key}
                                    variant="outline"
                                    className="h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-start data-pressed:border-primary"
                                    pressed={pendingKeySet.has(key)}
                                    onPressedChange={() => togglePoet(key)}
                                >
                                    {getPoetDisplayName(poet)}
                                </Toggle>
                            );
                        })}
                    </div>
                    {visiblePoets.length === 0 && (
                        <Empty className="py-6">
                            <EmptyDescription>شاعری با این جست‌وجو پیدا نشد.</EmptyDescription>
                        </Empty>
                    )}
                </DialogPanel>
                <DialogFooter>
                    <Button variant="outline" className="h-11" onClick={() => setPendingKeys(poets.map(getPoetKey))}>
                        انتخاب همه
                    </Button>
                    <Button variant="outline" className="h-11" onClick={() => setPendingKeys([])}>
                        پاک کردن
                    </Button>
                    <Button className="h-11" onClick={() => onSave(pendingKeys)}>
                        ذخیره
                    </Button>
                </DialogFooter>
            </DialogPopup>
        </Dialog>
    );
}
