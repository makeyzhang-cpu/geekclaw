/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  Message,
  Radio,
  Select,
  Tag,
  Tooltip,
} from '@arco-design/web-react';
import { AddOne, Delete, Export, FileEditingOne, Picture, Send, Video } from '@icon-park/react';
import classNames from 'classnames';
import { PlatformBadge } from './PlatformBadge';
import { checkForPlatform, charBudget, platformSpec } from './platforms';
import { createPost } from './cloudApi';
import type { SocialAccount, SocialPlatform, SocialPostVersion } from './types';

interface ComposePanelProps {
  accountsByPlatform: Map<SocialPlatform, SocialAccount[]>;
  platformState: {
    platform: SocialPlatform;
    configured: boolean;
    accountCount: number;
    connected: boolean;
    needsReauth: boolean;
  }[];
  demo: boolean;
  onCreated: () => void | Promise<void>;
  /** 从草稿继续编辑时带入。 */
  initial?: { postId: string; text: string };
}

/** 从 URL 后缀推断媒体类型——与上游按 MIME 判定的口径保持一致。 */
const inferMimeType = (url: string): string => {
  const path = url.split('?')[0].toLowerCase();
  if (/\.(mp4|mov|m4v|webm|avi|mkv)$/.test(path)) return 'video/mp4';
  if (/\.(png)$/.test(path)) return 'image/png';
  if (/\.(gif)$/.test(path)) return 'image/gif';
  if (/\.(webp)$/.test(path)) return 'image/webp';
  return 'image/jpeg';
};

/**
 * ComposePanel — 内容创作（一稿多投）。
 *
 * 这块界面回答的是**一条内容如何适配多个平台**，而不是「写一条微博」：
 *   1. 先写主文案——这是所有平台的默认内容；
 *   2. 勾选投放平台，被勾中的平台会各自展开一张卡片；
 *   3. 任何平台都可以**单独改写**（X 要压到 280 字、LinkedIn 可以铺开讲、
 *      Instagram 必须有图、YouTube/TikTok 必须有视频）；
 *   4. 每张卡片实时跑平台约束校验，不通过就标红并说明原因——**在提交前排掉
 *      注定失败的投递**，而不是等排期队列跑完再看一堆报错。
 */
const ComposePanel: React.FC<ComposePanelProps> = ({
  accountsByPlatform,
  platformState,
  demo,
  onCreated,
}) => {
  const [masterText, setMasterText] = useState('');
  const [selected, setSelected] = useState<SocialPlatform[]>([]);
  /** 平台专属改写。key 存在且非空 = 该平台用专属文案，否则回落主文案。 */
  const [overrides, setOverrides] = useState<Partial<Record<SocialPlatform, string>>>({});
  /** 每个平台选中的目标（账号 id 或 账号id::目标id）。 */
  const [targets, setTargets] = useState<Partial<Record<SocialPlatform, string[]>>>({});
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [mediaDraft, setMediaDraft] = useState('');
  const [mode, setMode] = useState<'now' | 'schedule'>('schedule');
  const [scheduledAt, setScheduledAt] = useState<string>('');
  const [campaign, setCampaign] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const configuredPlatforms = useMemo(
    () => platformState.filter((p) => p.configured).map((p) => p.platform),
    [platformState]
  );

  const effectiveText = useCallback(
    (platform: SocialPlatform) => {
      const own = overrides[platform];
      return own !== undefined && own.trim() !== '' ? own : masterText;
    },
    [overrides, masterText]
  );

  const mediaTypes = useMemo(() => mediaUrls.map(inferMimeType), [mediaUrls]);

  const checks = useMemo(() => {
    const map = new Map<SocialPlatform, ReturnType<typeof checkForPlatform>>();
    for (const platform of selected) {
      map.set(platform, checkForPlatform(platform, effectiveText(platform), mediaTypes));
    }
    return map;
  }, [selected, effectiveText, mediaTypes]);

  const blocking = useMemo(
    () => [...checks.entries()].filter(([, result]) => !result.ok),
    [checks]
  );

  const togglePlatform = useCallback(
    (platform: SocialPlatform) => {
      setSelected((prev) =>
        prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
      );
      // 默认把该平台所有已连接目标都选上——多数情况用户就是想全投。
      setTargets((prev) => {
        if (prev[platform]) return prev;
        const accounts = accountsByPlatform.get(platform) ?? [];
        const all: string[] = [];
        for (const account of accounts) {
          if (account.targets && account.targets.length > 0) {
            for (const target of account.targets) all.push(`${account.id}::${target.id}`);
          } else {
            all.push(account.id);
          }
        }
        return { ...prev, [platform]: all };
      });
    },
    [accountsByPlatform]
  );

  const addMedia = useCallback(() => {
    const url = mediaDraft.trim();
    if (!url) return;
    setMediaUrls((prev) => [...prev, url]);
    setMediaDraft('');
  }, [mediaDraft]);

  const handleSubmit = useCallback(async () => {
    if (selected.length === 0) {
      Message.warning('请至少选择一个投放平台。');
      return;
    }
    if (blocking.length > 0) {
      Message.error('有平台未通过校验，请先按提示修改。');
      return;
    }
    if (mode === 'schedule' && !scheduledAt) {
      Message.warning('请选择排期时间。');
      return;
    }

    setSubmitting(true);
    try {
      const versions: SocialPostVersion[] = selected
        .filter((platform) => {
          const own = overrides[platform];
          return own !== undefined && own.trim() !== '' && own !== masterText;
        })
        .map((platform) => ({
          platform,
          text: overrides[platform] as string,
          targetIds: (targets[platform] ?? [])
            .map((key) => key.split('::')[1])
            .filter((v): v is string => Boolean(v)),
        }));

      const flatTargets = selected.flatMap((platform) =>
        (targets[platform] ?? []).map((key) => {
          const [accountId, targetId] = key.split('::');
          return { accountId, targetId };
        })
      );

      await createPost({
        text: masterText,
        versions,
        targets: flatTargets,
        mediaIds: mediaUrls,
        scheduledAt: mode === 'schedule' ? new Date(scheduledAt).getTime() : undefined,
        campaign: campaign.trim() || undefined,
        publishNow: mode === 'now',
      });

      Message.success(mode === 'now' ? '已提交发布。' : '已加入排期队列。');
      setMasterText('');
      setOverrides({});
      setSelected([]);
      setTargets({});
      setMediaUrls([]);
      setScheduledAt('');
      await onCreated();
    } catch (error) {
      console.error('[social-matrix] create post failed', error);
      Message.error('提交失败：请确认云端社媒服务已部署且账号已完成授权。');
    } finally {
      setSubmitting(false);
    }
  }, [
    selected,
    blocking,
    mode,
    scheduledAt,
    overrides,
    masterText,
    targets,
    mediaUrls,
    campaign,
    onCreated,
  ]);

  return (
    <div className='flex flex-col gap-16px'>
      {/* 活动名 */}
      <div className='flex items-center gap-10px'>
        <span className='text-13px text-t-secondary shrink-0'>活动 / 系列</span>
        <Input
          size='small'
          value={campaign}
          onChange={setCampaign}
          placeholder='可选，例如「Factory Ops」——用于把同一批内容归拢'
          style={{ maxWidth: 360 }}
        />
      </div>

      {/* 主文案 */}
      <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'>
        <div className='mb-8px flex items-center gap-6px text-13px font-[600] text-t-primary'>
          <FileEditingOne theme='outline' size={15} />
          主文案
          <span className='text-11px font-[400] text-t-tertiary'>
            所有未单独改写的平台都用这段内容
          </span>
        </div>
        <Input.TextArea
          value={masterText}
          onChange={setMasterText}
          placeholder='写一次，之后再按平台各自调整。'
          autoSize={{ minRows: 5, maxRows: 14 }}
          showWordLimit={false}
        />
        <div className='mt-6px text-11px text-t-tertiary'>{masterText.trim().length} 字</div>
      </div>

      {/* 媒体 */}
      <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'>
        <div className='mb-8px flex items-center gap-6px text-13px font-[600] text-t-primary'>
          <Picture theme='outline' size={15} />
          媒体
          <span className='text-11px font-[400] text-t-tertiary'>
            Facebook 图片帖与 Instagram 直接取用媒体地址；YouTube / TikTok 需视频文件
          </span>
        </div>

        {mediaUrls.length > 0 && (
          <div className='mb-8px flex flex-col gap-6px'>
            {mediaUrls.map((url, index) => {
              const isVideo = inferMimeType(url).startsWith('video/');
              return (
                <div
                  key={`${url}-${index}`}
                  className='flex items-center gap-8px rounded-6px bg-[var(--color-fill-1)] px-10px py-8px'
                >
                  {isVideo ? (
                    <Video theme='outline' size={14} />
                  ) : (
                    <Picture theme='outline' size={14} />
                  )}
                  <span className='text-12px text-t-primary truncate flex-1'>{url}</span>
                  <Tag size='small'>{isVideo ? '视频' : '图片'}</Tag>
                  <Button
                    size='mini'
                    type='text'
                    status='danger'
                    icon={<Delete theme='outline' size={13} />}
                    onClick={() => setMediaUrls((prev) => prev.filter((_, i) => i !== index))}
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className='flex items-center gap-8px'>
          <Input
            size='small'
            value={mediaDraft}
            onChange={setMediaDraft}
            onPressEnter={addMedia}
            placeholder='粘贴图片或视频的公开地址（https://…）'
            style={{ maxWidth: 520 }}
          />
          <Button
            size='small'
            icon={<AddOne theme='outline' size={14} />}
            onClick={addMedia}
            disabled={!mediaDraft.trim()}
          >
            添加
          </Button>
        </div>
      </div>

      {/* 平台选择 */}
      <div className='box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'>
        <div className='mb-10px text-13px font-[600] text-t-primary'>投放平台</div>
        <div className='flex flex-wrap gap-8px'>
          {platformState.map(({ platform, configured, accountCount }) => {
            const spec = platformSpec(platform);
            const active = selected.includes(platform);
            const disabled = !configured || accountCount === 0 || demo;
            return (
              <Tooltip
                key={platform}
                position='top'
                content={
                  demo
                    ? '演示模式下不可提交'
                    : !configured
                      ? '该平台尚未在服务端接入发布通道'
                      : accountCount === 0
                        ? '还没有连接该平台的账号'
                        : spec.label
                }
              >
                <div
                  className={classNames(
                    'flex items-center gap-6px box-border rounded-6px border border-solid px-10px py-6px transition-all',
                    disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
                    active
                      ? 'border-[var(--color-primary-6)] bg-[var(--color-primary-1)]'
                      : 'border-[var(--color-border-2)] hover:border-[var(--color-border-3)]'
                  )}
                  onClick={() => !disabled && togglePlatform(platform)}
                >
                  <Checkbox checked={active} disabled={disabled} />
                  <PlatformBadge platform={platform} size='sm' />
                  <span className='text-12px text-t-primary'>{spec.label}</span>
                </div>
              </Tooltip>
            );
          })}
        </div>
        {configuredPlatforms.length === 0 && (
          <div className='mt-10px text-12px leading-20px text-t-tertiary'>
            目前没有任何平台完成服务端配置——请先在「账号矩阵」查看各平台的接入状态。
          </div>
        )}
      </div>

      {/* 逐平台卡片 */}
      {selected.map((platform) => {
        const spec = platformSpec(platform);
        const check = checks.get(platform);
        const accounts = accountsByPlatform.get(platform) ?? [];
        const budget = charBudget(platform, effectiveText(platform));
        const usingOverride = overrides[platform] !== undefined;

        const options = accounts.flatMap((account) => {
          if (account.targets && account.targets.length > 0) {
            return account.targets.map((target) => ({
              label: `${account.name} · ${target.name}`,
              value: `${account.id}::${target.id}`,
            }));
          }
          return [{ label: account.name, value: account.id }];
        });

        return (
          <div
            key={platform}
            className={classNames(
              'box-border rounded-8px border border-solid bg-[var(--color-bg-2)] p-12px',
              check && !check.ok
                ? 'border-[#f53f3f]'
                : 'border-[var(--color-border-2)]'
            )}
          >
            <div className='mb-8px flex items-center gap-8px'>
              <PlatformBadge platform={platform} size='sm' />
              <span className='text-13px font-[600] text-t-primary'>{spec.label}</span>
              <Checkbox
                checked={usingOverride}
                onChange={(checked) =>
                  setOverrides((prev) => {
                    const next = { ...prev };
                    if (checked) next[platform] = masterText;
                    else delete next[platform];
                    return next;
                  })
                }
              >
                <span className='text-12px text-t-secondary'>单独改写</span>
              </Checkbox>

              <div className='flex-1' />

              <span
                className={classNames(
                  'text-11px',
                  budget.over ? 'text-[#f53f3f]' : 'text-t-tertiary'
                )}
              >
                {budget.used} / {budget.limit}
              </span>
            </div>

            {usingOverride ? (
              <Input.TextArea
                value={overrides[platform] ?? ''}
                onChange={(value) => setOverrides((prev) => ({ ...prev, [platform]: value }))}
                autoSize={{ minRows: 3, maxRows: 10 }}
                placeholder={`适配 ${spec.label} 的版本`}
              />
            ) : (
              <div className='box-border rounded-6px bg-[var(--color-fill-1)] px-10px py-8px text-12px leading-18px text-t-secondary whitespace-pre-wrap break-words'>
                {masterText.trim() || <span className='text-t-tertiary'>（沿用主文案，当前为空）</span>}
              </div>
            )}

            {/* 字数进度条 */}
            <div className='mt-6px h-3px w-full rounded-full bg-[var(--color-fill-2)] overflow-hidden'>
              <div
                className='h-full rounded-full transition-all'
                style={{
                  width: `${Math.round(budget.ratio * 100)}%`,
                  background: budget.over ? '#f53f3f' : 'var(--color-primary-6)',
                }}
              />
            </div>

            {/* 目标选择 */}
            <div className='mt-10px flex items-center gap-8px'>
              <span className='text-12px text-t-secondary shrink-0'>发布到</span>
              <Select
                mode='multiple'
                size='small'
                value={targets[platform] ?? []}
                onChange={(value: string[]) =>
                  setTargets((prev) => ({ ...prev, [platform]: value }))
                }
                options={options}
                placeholder='选择发布目标'
                style={{ minWidth: 320, maxWidth: 520 }}
              />
            </div>

            {/* 校验结果 */}
            {check && !check.ok && (
              <div className='mt-8px text-12px text-[#f53f3f]'>✕ {check.reason}</div>
            )}
            {check?.ok && check.warning && (
              <div className='mt-8px text-12px text-[#ff7d00]'>! {check.warning}</div>
            )}
          </div>
        );
      })}

      {/* 提交区 */}
      <div className='flex items-center gap-12px box-border rounded-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] px-12px py-10px'>
        <Radio.Group
          type='button'
          size='small'
          value={mode}
          onChange={(value) => setMode(value as 'now' | 'schedule')}
        >
          <Radio value='schedule'>排期发布</Radio>
          <Radio value='now'>立即发布</Radio>
        </Radio.Group>

        {mode === 'schedule' && (
          <DatePicker
            size='small'
            showTime
            value={scheduledAt}
            onChange={(value) => setScheduledAt(value)}
            placeholder='选择发布日期与时间'
            style={{ width: 220 }}
          />
        )}

        <div className='flex-1' />

        {blocking.length > 0 && (
          <span className='text-12px text-[#f53f3f]'>
            {blocking.length} 个平台未通过校验
          </span>
        )}

        <Button
          type='primary'
          size='small'
          loading={submitting}
          disabled={demo || selected.length === 0 || blocking.length > 0}
          icon={mode === 'now' ? <Send theme='outline' size={14} /> : <Export theme='outline' size={14} />}
          onClick={() => void handleSubmit()}
        >
          {mode === 'now' ? '立即发布' : '加入排期队列'}
        </Button>
      </div>

      {demo && (
        <div className='text-12px leading-20px text-[#ff7d00]'>
          当前为演示模式，提交按钮已禁用。关闭演示模式（清除 localStorage 的
          <code className='mx-4px'>social:demo-mode</code>）后即可真实提交。
        </div>
      )}
    </div>
  );
};

export default ComposePanel;
