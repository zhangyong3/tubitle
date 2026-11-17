import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import {
  ChevronDown,
  ExternalLink,
  FlaskConical,
  Minus,
  Plus,
  Save,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';

import { tDynamic } from '@/core/i18n/dynamic';
import {
  APPEARANCE_ENABLED_KEY,
  COLOR_MODE_CONFIG_KEY,
  isAppearanceValue,
  type AppearanceKey,
} from '@/config/appearance';
import {
  getSettingGroups,
  getSettings,
  getSettingTabs,
  type Setting,
} from '@/modules/config/settings';
import { getTestSpec } from '@/modules/config/settings-test-specs';
import { apiGet, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import {
  appearanceOptions,
  colorModeOptions,
  useAppearance,
} from '@/hooks/use-appearance';
import { SettingsTestDialog } from '@/components/admin/settings-test-dialog';
import { AppearanceOptions } from '@/components/appearance-options';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

function AdminSettingsPage() {
  const placeholders: Record<string, string> = {
    creem_test_amount: m['admin.settings.placeholders.creem_test_amount'](),
    paypal_test_amount: m['admin.settings.placeholders.paypal_test_amount'](),
    alipay_test_amount: m['admin.settings.placeholders.alipay_test_amount'](),
    wechat_test_amount: m['admin.settings.placeholders.wechat_test_amount'](),
  };
  const queryClient = useQueryClient();
  const router = useRouter();
  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('general');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [testingGroup, setTestingGroup] = useState<string | null>(null);
  const [customRows, setCustomRows] = useState<
    { key: string; value: string }[]
  >([]);

  function toggleCollapse(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const tabs = getSettingTabs();
  const groups = getSettingGroups();
  const settings = getSettings();

  const { data: loadedConfigs, isLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => apiGet<Record<string, string>>('/api/admin/config'),
  });

  useEffect(() => {
    if (loadedConfigs) setConfigs(loadedConfigs);
  }, [loadedConfigs]);

  const { data: loadedCustom } = useQuery({
    queryKey: ['admin-config-custom'],
    queryFn: () =>
      apiGet<{ key: string; value: string }[]>('/api/admin/config/custom'),
  });

  useEffect(() => {
    if (loadedCustom) setCustomRows(loadedCustom);
  }, [loadedCustom]);

  function handleChange(name: string, value: string) {
    setConfigs((prev) => ({ ...prev, [name]: value }));
    if (INSTANT_SETTINGS.has(name)) instantSaveMutation.mutate({ name, value });
  }

  // Appearance settings save on click and repaint at once. Doesn't refetch
  // admin-config, which would wipe other unsaved edits in the form.
  const { applySiteAppearance } = useAppearance();
  const { setTheme } = useTheme();
  const instantSaveMutation = useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      apiPost('/api/admin/config', { [name]: value }),
    onSuccess: (_, { name, value }) => {
      if (name === APPEARANCE_ENABLED_KEY) {
        // Switches the style source (code vs settings); the root loader
        // re-renders <html> from it, keeping other unsaved form edits.
        router.invalidate();
        toast.success(m['admin.settings.applied']());
        return;
      }
      const key = ADMIN_APPEARANCE_FIELDS[name];
      if (key && isAppearanceValue(key, value)) {
        applySiteAppearance(key, value);
      } else if (name === COLOR_MODE_CONFIG_KEY) {
        // Preview it on the admin's own screen too.
        setTheme(value);
        router.invalidate();
      } else {
        router.invalidate();
      }
      queryClient.invalidateQueries({ queryKey: ['public-config'] });
      toast.success(m['admin.settings.applied']());
    },
    onError: (err: any) => {
      toast.error(err?.message || m['admin.settings.save_error']());
    },
  });

  function addCustomRow() {
    setCustomRows((prev) => [...prev, { key: '', value: '' }]);
  }

  function removeCustomRow(index: number) {
    setCustomRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCustomRow(
    index: number,
    field: 'key' | 'value',
    value: string
  ) {
    setCustomRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  const saveMutation = useMutation({
    mutationFn: (toSave: Record<string, string>) =>
      apiPost('/api/admin/config', toSave),
    onSuccess: () => {
      toast.success(m['admin.settings.save_success']());
      queryClient.invalidateQueries({ queryKey: ['admin-config'] });
      queryClient.invalidateQueries({ queryKey: ['public-config'] });
      // Root loader carries the site theme; re-run it to repaint.
      router.invalidate();
    },
    onError: (err: any) => {
      toast.error(err?.message || m['admin.settings.save_error']());
    },
  });

  const customSaveMutation = useMutation({
    mutationFn: (rows: { key: string; value: string }[]) =>
      apiPost('/api/admin/config/custom', { configs: rows }),
    onSuccess: () => {
      toast.success(m['admin.settings.save_success']());
      queryClient.invalidateQueries({ queryKey: ['admin-config-custom'] });
      queryClient.invalidateQueries({ queryKey: ['public-config'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || m['admin.settings.save_error']());
    },
  });

  const saving = saveMutation.isPending || customSaveMutation.isPending;

  function handleSave() {
    if (activeTab === 'custom') {
      const rows = customRows
        .map((r) => ({ key: r.key.trim(), value: r.value }))
        .filter((r) => r.key);
      customSaveMutation.mutate(rows);
      return;
    }
    const tabSettings = settings.filter((s) => s.tab === activeTab);
    const toSave: Record<string, string> = {};
    for (const s of tabSettings) {
      if (configs[s.name] !== undefined) {
        toSave[s.name] = configs[s.name];
      }
    }
    saveMutation.mutate(toSave);
  }

  const tabGroups = groups.filter((g) => g.tab === activeTab);
  const tabSettings = settings.filter((s) => s.tab === activeTab);

  return (
    <div className="space-y-6 p-6 lg:max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{m['admin.settings.title']()}</h1>
          <p className="text-muted-foreground">
            {m['admin.settings.description']()}
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="size-4" />
          {saving ? m['admin.settings.saving']() : m['admin.settings.save']()}
        </Button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Tabs: horizontal scroll strip on small screens, sticky side nav on lg+ */}
        <nav className="border-border -mx-6 flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b px-6 lg:sticky lg:top-6 lg:mx-0 lg:w-48 lg:flex-col lg:overflow-visible lg:border-b-0 lg:px-0">
          {tabs.map((tab) => (
            <button
              key={tab.name}
              onClick={() => setActiveTab(tab.name)}
              aria-current={activeTab === tab.name ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                'lg:mb-0 lg:rounded-md lg:border-b-0 lg:px-3 lg:text-left',
                activeTab === tab.name
                  ? 'border-primary text-foreground lg:bg-muted'
                  : 'text-muted-foreground hover:text-foreground lg:hover:bg-muted/50 border-transparent'
              )}
            >
              {tDynamic(`admin.settings.tabs.${tab.name}`)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {/* Groups */}
          {isLoading ? (
            <div className="text-muted-foreground">{m['admin.loading']()}</div>
          ) : activeTab === 'custom' ? (
            <Card>
              <CardHeader>
                <CardTitle>{m['admin.settings.custom.title']()}</CardTitle>
                <p className="text-muted-foreground text-sm">
                  {m['admin.settings.custom.description']()}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {customRows.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    {m['admin.settings.custom.empty']()}
                  </p>
                )}
                {customRows.map((row, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Input
                      value={row.key}
                      onChange={(e) =>
                        updateCustomRow(i, 'key', e.target.value)
                      }
                      placeholder={m['admin.settings.custom.key_placeholder']()}
                      className="w-1/3 shrink-0 font-mono"
                    />
                    <textarea
                      value={row.value}
                      onChange={(e) =>
                        updateCustomRow(i, 'value', e.target.value)
                      }
                      placeholder={m[
                        'admin.settings.custom.value_placeholder'
                      ]()}
                      rows={1}
                      className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 max-h-48 min-h-8 flex-1 resize-y rounded-lg border bg-transparent px-2.5 py-1 text-base leading-6 transition-colors outline-none focus-visible:ring-3 md:text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => removeCustomRow(i)}
                      aria-label={m['admin.settings.custom.remove']()}
                    >
                      <Minus className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={addCustomRow}
                  className="gap-1.5"
                >
                  <Plus className="size-4" />
                  {m['admin.settings.custom.add']()}
                </Button>
              </CardContent>
            </Card>
          ) : (
            tabGroups.map((group) => {
              const groupSettings = tabSettings.filter(
                (s) =>
                  s.group === group.name &&
                  // Appearance options only show once the switch is on.
                  (s.group !== 'appearance' ||
                    s.name === APPEARANCE_ENABLED_KEY ||
                    configs[APPEARANCE_ENABLED_KEY] === 'true')
              );
              if (groupSettings.length === 0) return null;

              const testSpec = getTestSpec(group.name);
              return (
                <Card key={group.name}>
                  <CardHeader
                    className="cursor-pointer select-none"
                    onClick={() => toggleCollapse(group.name)}
                  >
                    <div className="flex items-center justify-between">
                      <CardTitle>
                        {tDynamic(`admin.settings.groups.${group.name}.title`)}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {testSpec && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTestingGroup(group.name);
                            }}
                          >
                            <FlaskConical className="size-3.5" />
                            {m['admin.settings.test.button']()}
                          </Button>
                        )}
                        <ChevronDown
                          className={`text-muted-foreground size-5 transition-transform ${
                            collapsed.has(group.name) ? '-rotate-90' : ''
                          }`}
                        />
                      </div>
                    </div>
                  </CardHeader>
                  {!collapsed.has(group.name) && (
                    <CardContent className="space-y-4">
                      {groupSettings.map((setting) => (
                        <SettingField
                          key={setting.name}
                          setting={setting}
                          label={tDynamic(
                            `admin.settings.fields.${setting.name}`
                          )}
                          placeholder={
                            placeholders[setting.name] ?? setting.placeholder
                          }
                          tip={fieldTip(setting.name)}
                          extra={fieldExtra(setting.name, configs)}
                          value={
                            configs[setting.name] ?? setting.defaultValue ?? ''
                          }
                          onChange={(v) => handleChange(setting.name, v)}
                        />
                      ))}
                    </CardContent>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>

      {testingGroup && getTestSpec(testingGroup) && (
        <SettingsTestDialog
          open={!!testingGroup}
          onOpenChange={(open) => !open && setTestingGroup(null)}
          group={testingGroup}
          spec={getTestSpec(testingGroup)!}
          groupTitle={tDynamic(`admin.settings.groups.${testingGroup}.title`)}
          configOverrides={Object.fromEntries(
            settings
              .filter(
                (s) => s.group === testingGroup && configs[s.name] !== undefined
              )
              .map((s) => [s.name, configs[s.name]])
          )}
        />
      )}
    </div>
  );
}

// Saved secrets come back masked with this prefix (see modules/config/service).
const MASKED_PREFIX = '••••••••';

/**
 * Telegram's getUpdates link for the token in the form, so the admin can read
 * chat.id after messaging the bot. Built only from an unsaved, well-formed
 * token — a saved token is masked and never sent back to the browser.
 */
function TelegramChatIdHelper({
  configs,
}: {
  configs: Record<string, string>;
}) {
  const token = (configs.telegram_bot_token || '').trim();
  if (!token) return null;
  if (token.startsWith(MASKED_PREFIX)) {
    return (
      <p className="text-muted-foreground text-xs">
        {m['admin.settings.telegram_token_masked']()}
      </p>
    );
  }
  if (!/^\d+:[\w-]+$/.test(token)) return null;
  const base =
    (configs.telegram_api_base || '').trim() || 'https://api.telegram.org';
  const url = `${base.replace(/\/+$/, '')}/bot${token}/getUpdates`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
    >
      {m['admin.settings.telegram_get_chat_id']()}
      <ExternalLink className="size-3" />
    </a>
  );
}

function fieldExtra(name: string, configs: Record<string, string>): ReactNode {
  if (name === 'telegram_chat_id') {
    return <TelegramChatIdHelper configs={configs} />;
  }
  return null;
}

// Optional per-field help text: `admin.settings.tips.<name>` if defined.
function fieldTip(name: string): string | undefined {
  const key = `admin.settings.tips.${name}`;
  const text = tDynamic(key);
  return text === key ? undefined : text;
}

// Appearance settings render as chip pickers instead of a plain select.
const ADMIN_APPEARANCE_FIELDS: Record<string, AppearanceKey> = {
  app_theme: 'theme',
  app_font: 'font',
  app_font_size: 'fontSize',
  app_sidebar_variant: 'sidebarVariant',
  app_sidebar_collapsible: 'sidebarCollapsible',
};

// Saved as soon as they change, without the Save button.
const INSTANT_SETTINGS = new Set([
  APPEARANCE_ENABLED_KEY,
  ...Object.keys(ADMIN_APPEARANCE_FIELDS),
  COLOR_MODE_CONFIG_KEY,
  'user_theme_enabled',
]);

function SettingField({
  setting,
  label,
  placeholder,
  tip,
  extra,
  value,
  onChange,
}: {
  setting: Setting;
  label: string;
  placeholder?: string;
  tip?: string;
  /** Rendered between the input and the tip (field-specific helpers). */
  extra?: ReactNode;
  value: string;
  onChange: (value: string) => void;
}) {
  const tipNode = tip ? (
    <p className="text-muted-foreground text-xs leading-relaxed break-words whitespace-pre-line">
      {tip}
    </p>
  ) : null;

  const appearanceKey = ADMIN_APPEARANCE_FIELDS[setting.name];
  if (appearanceKey || setting.name === COLOR_MODE_CONFIG_KEY) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <AppearanceOptions
          options={
            appearanceKey
              ? appearanceOptions(appearanceKey)
              : colorModeOptions()
          }
          value={value}
          onChange={onChange}
        />
        {tipNode}
      </div>
    );
  }

  if (setting.type === 'switch') {
    return (
      <div className="space-y-2">
        <Label htmlFor={setting.name}>{label}</Label>
        <div>
          <Switch
            id={setting.name}
            checked={value === 'true'}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
        </div>
        {tipNode}
      </div>
    );
  }

  if (setting.type === 'select' && setting.options) {
    return (
      <div className="space-y-2">
        <Label htmlFor={setting.name}>{label}</Label>
        <Select value={value} onValueChange={(v) => onChange(v || '')}>
          <SelectTrigger>
            <SelectValue placeholder={placeholder || 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {setting.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tipNode}
      </div>
    );
  }

  if (setting.type === 'textarea') {
    return (
      <div className="space-y-2">
        <Label htmlFor={setting.name}>{label}</Label>
        <textarea
          id={setting.name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="border-input placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border bg-transparent px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
        />
        {tipNode}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={setting.name}>{label}</Label>
      <Input
        id={setting.name}
        type={
          setting.type === 'password'
            ? 'password'
            : setting.type === 'number'
              ? 'number'
              : 'text'
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {extra}
      {tipNode}
    </div>
  );
}

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
});
