/**
 * @license
 * Copyright 2025-2026 GeekClaw (geekclaw.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Drawer,
  Empty,
  Input,
  Message,
  Modal,
  Select,
  Spin,
  Tabs,
  Tag,
} from '@arco-design/web-react';
import { Plus, Search, Shop } from '@icon-park/react';
import classNames from 'classnames';
import HubPageShell from '@renderer/components/layout/HubPageShell';
import {
  CreateExpertPayload,
  ExpertDetail,
  ExpertScope,
  ExpertSummary,
  HireResponse,
  MyExpert,
  createExpert,
  getExpert,
  hireExpert,
  listExperts,
  myExperts,
} from './api';

const CATEGORIES = [
  '董事长',
  '写作',
  '营销',
  '商业',
  '数据',
  '思维',
  '情感',
  '编程',
  '教育',
  '翻译',
  '百科',
  '总结',
  '学术',
  '办公',
];

const PRESET_COLORS = [
  'bg-[rgba(99,102,241,0.16)] text-[rgb(99,102,241)]',
  'bg-[rgba(236,72,153,0.16)] text-[rgb(236,72,153)]',
  'bg-[rgba(16,185,129,0.16)] text-[rgb(16,185,129)]',
  'bg-[rgba(245,158,11,0.16)] text-[rgb(245,158,11)]',
  'bg-[rgba(59,130,246,0.16)] text-[rgb(59,130,246)]',
  'bg-[rgba(139,92,246,0.16)] text-[rgb(139,92,246)]',
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PRESET_COLORS[h % PRESET_COLORS.length];
}

/** 头像：优先 avatar URL；否则回退为带首字的中文彩色圆。 */
const ExpertAvatar: React.FC<{ name: string; avatar?: string | null; size?: number }> = ({
  name,
  avatar,
  size = 44,
}) => {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        style={{ width: size, height: size }}
        className='rounded-full object-cover shrink-0'
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={classNames(
        'rounded-full flex items-center justify-center font-700 shrink-0',
        colorFor(name)
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
};

const PriceTag: React.FC<{ price: number }> = ({ price }) => {
  if (price <= 0) {
    return (
      <span className='px-8px py-2px rd-6px bg-[rgba(16,185,129,0.14)] text-12px text-[rgb(16,185,129)] font-600'>
        免费
      </span>
    );
  }
  return (
    <span className='text-15px font-700 text-primary-6 leading-none'>
      {price}
      <span className='text-12px font-500 ml-2px text-t-tertiary'>积分</span>
    </span>
  );
};

interface ExpertCardProps {
  expert: ExpertSummary;
  onOpen: (expert: ExpertSummary) => void;
  onHire: (expert: ExpertSummary) => void;
}

const ExpertCard: React.FC<ExpertCardProps> = ({ expert, onOpen, onHire }) => (
  <div
    role='button'
    tabIndex={0}
    onClick={() => onOpen(expert)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(expert);
      }
    }}
    className='group relative flex flex-col gap-10px p-16px rd-12px border border-solid border-[var(--color-border-2)] bg-fill-1 hover:border-primary-6 hover:shadow-sm transition-all cursor-pointer outline-none'
  >
    <div className='flex items-start gap-10px'>
      <ExpertAvatar name={expert.name} avatar={expert.avatar} size={44} />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-6px'>
          <span className='text-15px font-600 text-t-primary leading-20px truncate'>{expert.name}</span>
          {expert.is_owned && (
            <Tag size='small' color='green' className='shrink-0'>
              已拥有
            </Tag>
          )}
        </div>
        <div className='text-12px leading-16px text-t-tertiary mt-2px truncate'>{expert.title}</div>
      </div>
    </div>

    <p className='text-13px leading-18px text-t-tertiary m-0 line-clamp-2 min-h-36px'>
      {expert.description || '—'}
    </p>

    {expert.tags.length > 0 && (
      <div className='flex flex-wrap gap-6px'>
        {expert.tags.slice(0, 4).map((tag) => (
          <span
            key={tag}
            className='px-8px py-2px rd-6px bg-fill-2 text-12px text-t-secondary leading-16px'
          >
            {tag}
          </span>
        ))}
      </div>
    )}

    <div className='flex items-center justify-between mt-2px pt-2px'>
      <PriceTag price={expert.price_credits} />
      <Button
        type={expert.is_owned ? 'secondary' : 'primary'}
        size='mini'
        onClick={(e) => {
          e.stopPropagation();
          onHire(expert);
        }}
      >
        {expert.is_owned ? '打开分身' : '雇佣'}
      </Button>
    </div>
  </div>
);

const MyExpertCard: React.FC<{ item: MyExpert; onOpen: (companionRef: string) => void }> = ({
  item,
  onOpen,
}) => (
  <div className='flex items-center gap-10px p-14px rd-12px border border-solid border-[var(--color-border-2)] bg-fill-1'>
    <ExpertAvatar name={item.name} avatar={item.avatar} size={40} />
    <div className='min-w-0 flex-1'>
      <div className='text-14px font-600 text-t-primary truncate'>{item.name}</div>
      <div className='text-12px leading-16px text-t-tertiary truncate'>{item.title}</div>
    </div>
    <Button
      type='primary'
      size='mini'
      onClick={() => onOpen(item.companion_ref)}
    >
      打开分身
    </Button>
  </div>
);

const ExpertMarketPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'builtin' | 'custom' | 'mine'>('builtin');
  const [loading, setLoading] = useState(true);
  const [experts, setExperts] = useState<ExpertSummary[]>([]);
  const [mine, setMine] = useState<MyExpert[]>([]);

  const [category, setCategory] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');

  const [detail, setDetail] = useState<ExpertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [hireTarget, setHireTarget] = useState<ExpertSummary | null>(null);
  const [hireLoading, setHireLoading] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState<CreateExpertPayload>({
    name: '',
    title: '',
    description: '',
    tags: [],
    category: '',
    price_credits: 0,
    persona_custom: '',
    persona_preset: 'lively',
    default_character: 'mochi',
    default_model: '',
    default_model_provider: '',
    default_skills: [],
  });

  const scope: ExpertScope = tab === 'custom' ? 'custom' : 'builtin';

  const loadMarket = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listExperts(category, query.trim() || undefined, scope);
      setExperts(list);
    } catch (err) {
      Message.error(String(err));
    } finally {
      setLoading(false);
    }
  }, [category, query, scope]);

  const loadMine = useCallback(async () => {
    try {
      setMine(await myExperts());
    } catch (err) {
      Message.error(String(err));
    }
  }, []);

  useEffect(() => {
    if (tab !== 'mine') void loadMarket();
  }, [loadMarket, tab]);

  useEffect(() => {
    if (tab === 'mine') void loadMine();
  }, [tab, loadMine]);

  const openDetail = useCallback(async (expert: ExpertSummary) => {
    setDetail(null);
    setDetailLoading(true);
    try {
      const full = await getExpert(expert.slug);
      setDetail(full);
    } catch (err) {
      Message.error(String(err));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const goToCompanion = useCallback(
    (companionRef: string) => {
      navigate(`/geekclaw?companion=${encodeURIComponent(companionRef)}`);
    },
    [navigate]
  );

  const performHire = useCallback(
    async (expert: ExpertSummary) => {
      setHireLoading(true);
      try {
        const res: HireResponse = await hireExpert(expert.slug);
        Message.success(
          res.already_owned
            ? t('expertMarket.alreadyOwned', { defaultValue: '已拥有该专家数字分身，已为你打开' })
            : t('expertMarket.hired', { defaultValue: '雇佣成功，数字分身已生成' })
        );
        setHireTarget(null);
        setBalance(res.balance);
        void loadMarket();
        void loadMine();
        goToCompanion(res.companion_id);
      } catch (err) {
        Message.error(String(err));
      } finally {
        setHireLoading(false);
      }
    },
    [goToCompanion, loadMarket, loadMine, t]
  );

  const requestHire = useCallback(
    (expert: ExpertSummary) => {
      if (expert.is_owned) {
        // 幂等：直接走雇佣拿到既有的 companion_id 并跳转，不弹扣费确认。
        void performHire(expert);
        return;
      }
      setHireTarget(expert);
    },
    [performHire]
  );

  const filteredMine = useMemo(() => mine, [mine]);

  const resetCreateForm = useCallback(() => {
    setCreateForm({
      name: '',
      title: '',
      description: '',
      tags: [],
      category: '',
      price_credits: 0,
      persona_custom: '',
      persona_preset: 'lively',
      default_character: 'mochi',
      default_model: '',
      default_model_provider: '',
      default_skills: [],
    });
  }, []);

  const submitCreate = useCallback(async () => {
    if (!createForm.name.trim() || !createForm.title.trim()) {
      Message.error(t('expertMarket.createRequired', { defaultValue: '请填写专家名称和头衔' }));
      return;
    }
    setCreateLoading(true);
    try {
      const payload: CreateExpertPayload = {
        ...createForm,
        name: createForm.name.trim(),
        title: createForm.title.trim(),
        description: createForm.description?.trim() || undefined,
        category: createForm.category?.trim() || undefined,
        price_credits: Number(createForm.price_credits) || 0,
        persona_custom: createForm.persona_custom?.trim() || undefined,
        persona_preset: createForm.persona_preset?.trim() || 'lively',
        default_character: createForm.default_character?.trim() || 'mochi',
        default_model: createForm.default_model?.trim() || undefined,
        default_model_provider: createForm.default_model_provider?.trim() || undefined,
      };
      await createExpert(payload);
      Message.success(t('expertMarket.createSuccess', { defaultValue: '专家创建成功' }));
      setCreateOpen(false);
      resetCreateForm();
      void loadMarket();
    } catch (err) {
      Message.error(String(err));
    } finally {
      setCreateLoading(false);
    }
  }, [createForm, loadMarket, resetCreateForm, t]);

  return (
    <HubPageShell
      title={t('expertMarket.title', { defaultValue: '专家数字分身市场' })}
      subtitle={t('expertMarket.subtitle', {
        defaultValue: '把行业专家雇佣成你的数字分身伙伴，即开即用、随取随聊。',
      })}
      toolbar={
        <div className='flex items-center justify-between w-full'>
          <Tabs activeTab={tab} onChange={(key) => setTab(key as 'builtin' | 'custom' | 'mine')}>
            <Tabs.TabPane
              key='builtin'
              title={t('expertMarket.tabBuiltin', { defaultValue: '内置目录' })}
            />
            <Tabs.TabPane
              key='custom'
              title={t('expertMarket.tabCustom', { defaultValue: '自定义专家' })}
            />
            <Tabs.TabPane
              key='mine'
              title={`${t('expertMarket.tabMine', { defaultValue: '我的专家' })}${
                mine.length ? ` (${mine.length})` : ''
              }`}
            />
          </Tabs>
          <div className='flex items-center gap-10px'>
            <Button
              type='primary'
              size='small'
              icon={<Plus size={16} />}
              onClick={() => navigate('/geekclaw')}
            >
              {t('expertMarket.newCompanion', { defaultValue: '新建伙伴' })}
            </Button>
            {tab !== 'mine' && (
              <Button
                type='primary'
                size='small'
                icon={<Plus size={16} />}
                onClick={() => setCreateOpen(true)}
              >
                {t('expertMarket.createExpert', { defaultValue: '创建专家' })}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {tab !== 'mine' ? (
        <>
          <div className='flex flex-wrap items-center gap-10px mb-18px'>
            <Input
              allowClear
              prefix={<Search size={16} />}
              placeholder={t('expertMarket.searchPlaceholder', { defaultValue: '搜索专家名称 / 头衔 / 标签' })}
              value={query}
              onChange={setQuery}
              style={{ width: 280 }}
            />
            <Select
              allowClear
              placeholder={t('expertMarket.categoryPlaceholder', { defaultValue: '全部分类' })}
              value={category}
              onChange={(v) => setCategory(v)}
              style={{ width: 160 }}
              options={CATEGORIES.map((c) => ({ label: c, value: c }))}
            />
          </div>

          {loading ? (
            <div className='flex items-center justify-center py-60px'>
              <Spin />
            </div>
          ) : experts.length === 0 ? (
            <div className='flex flex-col items-center gap-12px py-40px'>
              <Empty description={t('expertMarket.empty', { defaultValue: '没有匹配到的专家' })} />
              <div className='flex items-center gap-10px'>
                <Button type='primary' icon={<Shop size={16} />} onClick={() => void loadMarket()}>
                  {t('expertMarket.title', { defaultValue: '专家数字分身市场' })}
                </Button>
                <Button icon={<Plus size={16} />} onClick={() => navigate('/geekclaw')}>
                  {t('expertMarket.newCompanion', { defaultValue: '新建伙伴' })}
                </Button>
              </div>
            </div>
          ) : (
            <div className='grid gap-14px grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {experts.map((e) => (
                <ExpertCard key={e.expert_id} expert={e} onOpen={openDetail} onHire={requestHire} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {mine.length === 0 ? (
            <div className='flex flex-col items-center gap-12px py-40px'>
              <Empty description={t('expertMarket.mineEmpty', { defaultValue: '还没有雇佣任何专家' })} />
              <Button type='primary' icon={<Shop size={16} />} onClick={() => setTab('builtin')}>
                {t('expertMarket.title', { defaultValue: '专家数字分身市场' })}
              </Button>
              <Button icon={<Plus size={16} />} onClick={() => navigate('/geekclaw')}>
                {t('expertMarket.newCompanion', { defaultValue: '新建伙伴' })}
              </Button>
            </div>
          ) : (
            <div className='grid gap-12px grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'>
              {filteredMine.map((m) => (
                <MyExpertCard key={m.expert_id} item={m} onOpen={goToCompanion} />
              ))}
            </div>
          )}
        </>
      )}

      {/* 专家详情抽屉 */}
      <Drawer
        width={420}
        title={detail ? detail.name : t('expertMarket.detail', { defaultValue: '专家详情' })}
        visible={detail !== null}
        onCancel={() => setDetail(null)}
        footer={
          detail && (
            <div className='flex items-center justify-between'>
              <PriceTag price={detail.price_credits} />
              <Button
                type='primary'
                loading={hireLoading}
                onClick={() => {
                  const base = experts.find((e) => e.expert_id === detail.expert_id) ?? null;
                  setHireTarget(
                    base ?? {
                      expert_id: detail.expert_id,
                      slug: detail.slug,
                      name: detail.name,
                      title: detail.title,
                      description: detail.description,
                      avatar: detail.avatar,
                      tags: detail.tags,
                      category: detail.category,
                      price_credits: detail.price_credits,
                      is_owned: detail.is_owned,
                    }
                  );
                }}
              >
                {detail.is_owned ? '打开分身' : '雇佣'}
              </Button>
            </div>
          )
        }
      >
        {detailLoading ? (
          <div className='flex items-center justify-center py-40px'>
            <Spin />
          </div>
        ) : detail ? (
          <div className='flex flex-col gap-16px'>
            <div className='flex items-center gap-12px'>
              <ExpertAvatar name={detail.name} avatar={detail.avatar} size={56} />
              <div>
                <div className='text-17px font-700 text-t-primary'>{detail.name}</div>
                <div className='text-13px text-t-tertiary mt-2px'>{detail.title}</div>
              </div>
            </div>

            {detail.category && (
              <Tag size='small' color='arcoblue'>
                {detail.category}
              </Tag>
            )}

            <div>
              <div className='text-13px font-600 text-t-secondary mb-4px'>
                {t('expertMarket.about', { defaultValue: '简介' })}
              </div>
              <p className='text-13px leading-20px text-t-tertiary m-0 whitespace-pre-wrap'>
                {detail.description || '—'}
              </p>
            </div>

            {detail.tags.length > 0 && (
              <div className='flex flex-wrap gap-6px'>
                {detail.tags.map((tag) => (
                  <span
                    key={tag}
                    className='px-8px py-2px rd-6px bg-fill-2 text-12px text-t-secondary'
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className='rounded-lg bg-fill-2 p-12px'>
              <div className='text-13px font-600 text-t-secondary mb-6px'>
                {t('expertMarket.persona', { defaultValue: '专家人格设定' })}
              </div>
              <p className='text-12px leading-18px text-t-tertiary m-0 whitespace-pre-wrap max-h-180px overflow-y-auto'>
                {detail.persona_custom || '—'}
              </p>
            </div>

            <div className='flex flex-wrap gap-x-20px gap-y-8px text-12px text-t-tertiary'>
              <div>
                <span className='text-t-secondary'>{t('expertMarket.preset', { defaultValue: '人格预设' })}：</span>
                {detail.persona_preset || '—'}
              </div>
              <div>
                <span className='text-t-secondary'>{t('expertMarket.character', { defaultValue: '形象' })}：</span>
                {detail.default_character || '—'}
              </div>
              {detail.default_model && (
                <div>
                  <span className='text-t-secondary'>{t('expertMarket.model', { defaultValue: '默认模型' })}：</span>
                  {detail.default_model_provider ? `${detail.default_model_provider} / ` : ''}
                  {detail.default_model}
                </div>
              )}
            </div>

            {detail.default_skills.length > 0 && (
              <div>
                <div className='text-13px font-600 text-t-secondary mb-4px'>
                  {t('expertMarket.skills', { defaultValue: '内置技能' })}
                </div>
                <div className='flex flex-wrap gap-6px'>
                  {detail.default_skills.map((s) => (
                    <span
                      key={s}
                      className='px-8px py-2px rd-6px bg-[rgba(99,102,241,0.12)] text-12px text-[rgb(99,102,241)]'
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Drawer>

      {/* 雇佣确认弹窗 */}
      <Modal
        title={t('expertMarket.hireConfirmTitle', { defaultValue: '确认雇佣' })}
        visible={hireTarget !== null}
        onCancel={() => setHireTarget(null)}
        onOk={() => {
          if (hireTarget) void performHire(hireTarget);
        }}
        confirmLoading={hireLoading}
        okText={t('expertMarket.confirmHire', { defaultValue: '确认雇佣' })}
        cancelText={t('common.cancel', { defaultValue: '取消' })}
      >
        {hireTarget && (
          <div className='flex flex-col gap-12px'>
            <div className='flex items-center gap-10px'>
              <ExpertAvatar name={hireTarget.name} avatar={hireTarget.avatar} size={40} />
              <div>
                <div className='text-14px font-600 text-t-primary'>{hireTarget.name}</div>
                <div className='text-12px text-t-tertiary'>{hireTarget.title}</div>
              </div>
            </div>
            <div className='text-13px leading-18px text-t-secondary'>
              {t('expertMarket.hireConfirmDesc', {
                defaultValue:
                  '雇佣后将自动为你生成专属数字分身伙伴，并注入该专家的人设、技能与模型配置，可在「桌面伙伴」中随时对话。',
              })}
            </div>
            <div className='flex items-center justify-between rounded-lg bg-fill-2 px-12px py-10px'>
              <span className='text-13px text-t-secondary'>应付积分</span>
              <PriceTag price={hireTarget.price_credits} />
            </div>
          </div>
        )}
      </Modal>

      {/* 创建自定义专家弹窗 */}
      <Modal
        title={t('expertMarket.createTitle', { defaultValue: '创建自定义专家' })}
        visible={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          resetCreateForm();
        }}
        onOk={() => void submitCreate()}
        confirmLoading={createLoading}
        okText={t('expertMarket.createSubmit', { defaultValue: '创建' })}
        cancelText={t('common.cancel', { defaultValue: '取消' })}
      >
        <div className='flex flex-col gap-12px max-h-70vh overflow-y-auto pr-4px'>
          <Input
            placeholder={t('expertMarket.createName', { defaultValue: '专家名称 *' })}
            value={createForm.name}
            onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))}
            maxLength={40}
            showWordLimit
          />
          <Input
            placeholder={t('expertMarket.createTitleLabel', { defaultValue: '专家头衔 *' })}
            value={createForm.title}
            onChange={(v) => setCreateForm((f) => ({ ...f, title: v }))}
            maxLength={80}
            showWordLimit
          />
          <Select
            placeholder={t('expertMarket.categoryPlaceholder', { defaultValue: '分类' })}
            value={createForm.category || undefined}
            onChange={(v) => setCreateForm((f) => ({ ...f, category: v }))}
            allowClear
            options={CATEGORIES.map((c) => ({ label: c, value: c }))}
          />
          <Input
            type='number'
            min={0}
            placeholder={t('expertMarket.createPrice', { defaultValue: '雇佣积分（0=免费）' })}
            value={String(createForm.price_credits ?? 0)}
            onChange={(v) => setCreateForm((f) => ({ ...f, price_credits: Number(v) || 0 }))}
          />
          <Input.TextArea
            placeholder={t('expertMarket.createDescription', { defaultValue: '专家简介' })}
            value={createForm.description}
            onChange={(v) => setCreateForm((f) => ({ ...f, description: v }))}
            rows={2}
          />
          <Input
            placeholder={t('expertMarket.createTags', { defaultValue: '标签，用逗号分隔' })}
            value={(createForm.tags ?? []).join(', ')}
            onChange={(v) =>
              setCreateForm((f) => ({
                ...f,
                tags: v.split(',').map((s) => s.trim()).filter(Boolean),
              }))
            }
          />
          <Select
            placeholder={t('expertMarket.createPreset', { defaultValue: '人格预设' })}
            value={createForm.persona_preset}
            onChange={(v) => setCreateForm((f) => ({ ...f, persona_preset: v }))}
            options={[
              { label: '活泼 (lively)', value: 'lively' },
              { label: '沉稳 (calm)', value: 'calm' },
              { label: '俏皮 (sassy)', value: 'sassy' },
            ]}
          />
          <Input.TextArea
            placeholder={t('expertMarket.createPersona', { defaultValue: '人格自定义（系统提示词）' })}
            value={createForm.persona_custom}
            onChange={(v) => setCreateForm((f) => ({ ...f, persona_custom: v }))}
            rows={4}
          />
          <Select
            placeholder={t('expertMarket.createCharacter', { defaultValue: '默认形象' })}
            value={createForm.default_character}
            onChange={(v) => setCreateForm((f) => ({ ...f, default_character: v }))}
            options={[
              { label: 'Mochi', value: 'mochi' },
              { label: 'Bubble', value: 'bubble' },
              { label: 'Geek', value: 'geek' },
            ]}
          />
          <Input
            placeholder={t('expertMarket.createModelProvider', { defaultValue: '默认模型提供方，如 openai / deepseek' })}
            value={createForm.default_model_provider}
            onChange={(v) => setCreateForm((f) => ({ ...f, default_model_provider: v }))}
          />
          <Input
            placeholder={t('expertMarket.createModel', { defaultValue: '默认模型，如 gpt-4o / deepseek-chat' })}
            value={createForm.default_model}
            onChange={(v) => setCreateForm((f) => ({ ...f, default_model: v }))}
          />
          <Input
            placeholder={t('expertMarket.createSkills', { defaultValue: '默认技能，用逗号分隔' })}
            value={(createForm.default_skills ?? []).join(', ')}
            onChange={(v) =>
              setCreateForm((f) => ({
                ...f,
                default_skills: v.split(',').map((s) => s.trim()).filter(Boolean),
              }))
            }
          />
        </div>
      </Modal>
    </HubPageShell>
  );
};

export default ExpertMarketPage;
