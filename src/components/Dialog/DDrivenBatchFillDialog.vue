<template>
  <QDialog v-model="dialogOpened" persistent>
    <QCard class="d-driven-dialog bg-background text-display">
      <QCardSection class="row items-center q-pb-sm">
        <div>
          <div class="text-h6 text-bold">D 批量预填</div>
          <div class="text-caption text-display">
            读取 pr-subtitles-D.json，按角色分配音色并批量回填到 TalkEditor。
          </div>
        </div>
        <QSpace />
        <QBtn
          flat
          round
          icon="refresh"
          color="primary"
          :loading
          @click="loadManifest"
        />
        <QBtn
          flat
          round
          icon="close"
          color="display"
          @click="dialogOpened = false"
        />
      </QCardSection>

      <QCardSection class="q-pt-none q-pb-sm meta-section">
        <div class="meta-line">
          <span class="meta-label">工作目录</span>
          <span class="meta-value">{{ workingDir || "未设置" }}</span>
        </div>
        <div class="meta-line">
          <span class="meta-label">Manifest</span>
          <span class="meta-value">{{ manifestPath || "未加载" }}</span>
        </div>
        <QBanner
          v-if="errorMessage"
          dense
          rounded
          class="q-mt-sm bg-red-1 text-negative"
        >
          {{ errorMessage }}
        </QBanner>
      </QCardSection>

      <QCardSection v-if="loadedManifest" class="content-grid q-pt-none">
        <section class="left-panel">
          <div class="section-header">
            <div class="section-title">角色筛选</div>
            <QToggle
              v-model="onlyPending"
              label="仅导入未生成项"
              color="primary"
            />
          </div>
          <div v-if="roleSummaries.length === 0" class="empty-state">
            当前 D manifest 里没有可用角色。
          </div>
          <label
            v-for="summary in roleSummaries"
            :key="summary.role"
            class="role-card"
          >
            <QCheckbox
              v-model="selectedRoles"
              :val="summary.role"
              color="primary"
            />
            <div class="role-main">
              <div class="role-topline">
                <span class="role-name">{{ summary.role }}</span>
                <QChip dense square color="primary" textColor="white">
                  {{ summary.pending }}/{{ summary.total }} 待处理
                </QChip>
              </div>
              <div class="role-subline">
                首条 #{{ summary.firstOrder }} · 已生成
                {{ summary.generated }} 条
              </div>
              <div class="role-sample">{{ summary.sampleText }}</div>
            </div>
          </label>
        </section>

        <section class="right-panel">
          <div class="section-title">角色对应音色</div>
          <div v-if="selectedRoles.length === 0" class="empty-state">
            先在左侧勾选至少一个角色。
          </div>
          <div v-for="role in selectedRoles" :key="role" class="mapping-row">
            <div class="mapping-role">{{ role }}</div>
            <QSelect
              v-model="roleVoiceValues[role]"
              dense
              outlined
              emitValue
              mapOptions
              optionLabel="label"
              optionValue="value"
              :options="voiceOptions"
              :disable="voiceOptions.length === 0"
            />
          </div>

          <QSeparator class="q-my-md" />

          <div class="section-title">导入预览</div>
          <div class="preview-summary">
            将按当前筛选导入/更新
            <strong>{{ previewCues.length }}</strong> 条台词。
          </div>
          <div
            v-if="previewCues.length === 0"
            class="empty-state preview-empty"
          >
            当前筛选下没有可导入的 cue。
          </div>
          <div v-else class="cue-list">
            <div
              v-for="cue in visiblePreviewCues"
              :key="cue.order"
              class="cue-row"
            >
              <span class="cue-order">#{{ cue.order }}</span>
              <span class="cue-role">{{ cue.role }}</span>
              <span class="cue-text">{{ cue.jaText }}</span>
            </div>
            <div
              v-if="previewCues.length > visiblePreviewCues.length"
              class="cue-more"
            >
              还有
              {{ previewCues.length - visiblePreviewCues.length }} 条未展开。
            </div>
          </div>
        </section>
      </QCardSection>

      <QCardActions align="right" class="q-pa-md">
        <QBtn flat label="取消" color="display" @click="dialogOpened = false" />
        <QBtn
          unelevated
          color="primary"
          label="导入到编辑器"
          :loading
          :disable="previewCues.length === 0 || selectedRoles.length === 0"
          @click="applyCues"
        />
      </QCardActions>
    </QCard>
  </QDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "@/store";
import {
  VoiceId,
  type Voice,
  type VoiceId as VoiceIdType,
} from "@/type/preload";
import {
  filterCharacterInfosByStyleType,
  formatCharacterStyleName,
} from "@/store/utility";
import type {
  DDrivenManifest,
  DDrivenRoleSummary,
  DDrivenCue,
} from "@/helpers/dDrivenManifest";

const dialogOpened = defineModel<boolean>("dialogOpened", { default: false });
const store = useStore();

const loading = ref(false);
const errorMessage = ref("");
const manifestPath = ref("");
const loadedManifest = ref<DDrivenManifest>();
const roleSummaries = ref<DDrivenRoleSummary[]>([]);
const generatedOrders = ref<number[]>([]);
const selectedRoles = ref<string[]>([]);
const onlyPending = ref(true);
const roleVoiceValues = ref<Record<string, VoiceIdType | "">>({});

const workingDir = computed(() => store.state.savingSetting.vpmWorkingDir);
const activeAudioKey = computed(() => store.getters.ACTIVE_AUDIO_KEY);
const activeVoiceValue = computed<VoiceIdType | "">(() => {
  const audioKey = activeAudioKey.value;
  if (!audioKey) return defaultVoiceValue.value;
  return VoiceId(store.state.audioItems[audioKey].voice);
});

const voiceOptions = computed(() => {
  const talkCharacterInfos = filterCharacterInfosByStyleType(
    store.getters.GET_ORDERED_ALL_CHARACTER_INFOS,
    "talk",
  );

  return talkCharacterInfos.flatMap((characterInfo) =>
    characterInfo.metas.styles.map((style) => {
      const voice: Voice = {
        engineId: style.engineId,
        speakerId: characterInfo.metas.speakerUuid,
        styleId: style.styleId,
      };

      return {
        label: formatCharacterStyleName(
          characterInfo.metas.speakerName,
          style.styleName,
        ),
        value: VoiceId(voice),
        voice,
      };
    }),
  );
});

const voiceMap = computed(
  () =>
    new Map(voiceOptions.value.map((option) => [option.value, option.voice])),
);
const defaultVoiceValue = computed<VoiceIdType | "">(
  () => voiceOptions.value[0]?.value ?? "",
);

const previewCues = computed<DDrivenCue[]>(() => {
  if (!loadedManifest.value) return [];

  const roleSet = new Set(selectedRoles.value);
  const generatedOrderSet = new Set(generatedOrders.value);

  return loadedManifest.value.cues.filter((cue) => {
    if (!roleSet.has(cue.role)) return false;
    if (!onlyPending.value) return true;
    return !generatedOrderSet.has(cue.order);
  });
});

const visiblePreviewCues = computed(() => previewCues.value.slice(0, 14));

const ensureRoleVoiceDefaults = (roles: string[]) => {
  const nextValues = { ...roleVoiceValues.value };
  const fallbackVoice = activeVoiceValue.value || defaultVoiceValue.value;

  for (const role of roles) {
    const currentValue = nextValues[role];
    if (!currentValue || !voiceMap.value.has(currentValue)) {
      nextValues[role] = fallbackVoice;
    }
  }

  for (const role of Object.keys(nextValues)) {
    if (!roles.includes(role)) {
      delete nextValues[role];
    }
  }

  roleVoiceValues.value = nextValues;
};

const applyDefaultRoleSelection = (summaries: DDrivenRoleSummary[]) => {
  const pendingRoles = summaries
    .filter((summary) => summary.pending > 0)
    .map((summary) => summary.role);
  const nextRoles =
    pendingRoles.length > 0
      ? pendingRoles
      : summaries.map((summary) => summary.role);

  selectedRoles.value = nextRoles;
  ensureRoleVoiceDefaults(nextRoles);
};

const resetManifestState = () => {
  loadedManifest.value = undefined;
  roleSummaries.value = [];
  manifestPath.value = "";
  generatedOrders.value = [];
  selectedRoles.value = [];
};

const loadManifest = async () => {
  loading.value = true;
  errorMessage.value = "";

  try {
    const loaded = await store.actions.LOAD_D_DRIVEN_MANIFEST({});
    loadedManifest.value = loaded.manifest;
    roleSummaries.value = loaded.roleSummaries;
    manifestPath.value = loaded.manifestPath;
    generatedOrders.value = loaded.generatedOrders;
    applyDefaultRoleSelection(loaded.roleSummaries);
  } catch (error) {
    resetManifestState();
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
};

const applyCues = async () => {
  if (previewCues.value.length === 0) return;

  const missingVoiceRoles = selectedRoles.value.filter((role) => {
    const voiceValue = roleVoiceValues.value[role];
    return !voiceValue || !voiceMap.value.has(voiceValue);
  });

  if (missingVoiceRoles.length > 0) {
    await store.actions.SHOW_ALERT_DIALOG({
      title: "角色音色未设置",
      message: `请先为这些角色选择音色：${missingVoiceRoles.join("、")}`,
    });
    return;
  }

  const cueAssignments = previewCues.value.flatMap((cue) => {
    const voiceId = roleVoiceValues.value[cue.role];
    const voice = voiceId ? voiceMap.value.get(voiceId) : undefined;
    return voice ? [{ cue, voice }] : [];
  });

  loading.value = true;
  try {
    const audioKeys = await store.actions.COMMAND_APPLY_D_CUES({
      cueAssignments,
    });

    dialogOpened.value = false;
    await store.actions.SHOW_ALERT_DIALOG({
      title: "D 批量预填已完成",
      message: `已导入或更新 ${audioKeys.length} 条 cue。`,
    });
  } finally {
    loading.value = false;
  }
};

watch(
  () => dialogOpened.value,
  (opened) => {
    if (opened) {
      void loadManifest();
    }
  },
);

watch(
  () => selectedRoles.value,
  (roles) => {
    ensureRoleVoiceDefaults(roles);
  },
  { deep: true },
);

watch(
  () => voiceOptions.value,
  () => {
    ensureRoleVoiceDefaults(selectedRoles.value);
  },
  { deep: true },
);
</script>

<style scoped lang="scss">
.d-driven-dialog {
  width: min(1120px, 92vw);
  max-width: 1120px;
}

.meta-section {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.meta-line {
  display: grid;
  grid-template-columns: 5rem 1fr;
  gap: 0.75rem;
  font-size: 0.85rem;
  line-height: 1.5;
}

.meta-label {
  color: rgba(0, 0, 0, 0.6);
}

.meta-value {
  word-break: break-all;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: 1rem;
}

.left-panel,
.right-panel {
  min-height: 420px;
}

.left-panel {
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  padding-right: 1rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 700;
}

.role-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.7rem 0.75rem;
  margin-bottom: 0.6rem;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
}

.role-main {
  min-width: 0;
}

.role-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.role-name {
  font-weight: 700;
}

.role-subline {
  font-size: 0.78rem;
  color: rgba(0, 0, 0, 0.58);
  margin-top: 0.15rem;
}

.role-sample {
  margin-top: 0.35rem;
  font-size: 0.82rem;
  line-height: 1.45;
  color: rgba(0, 0, 0, 0.8);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mapping-row {
  display: grid;
  grid-template-columns: 10rem minmax(0, 1fr);
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.7rem;
}

.mapping-role {
  font-weight: 600;
}

.preview-summary {
  margin-bottom: 0.7rem;
  font-size: 0.84rem;
  color: rgba(0, 0, 0, 0.7);
}

.cue-list {
  max-height: 320px;
  overflow: auto;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
}

.cue-row {
  display: grid;
  grid-template-columns: 4.5rem 7rem minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.65rem 0.8rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  font-size: 0.83rem;
  align-items: start;
}

.cue-row:last-child {
  border-bottom: none;
}

.cue-order,
.cue-role {
  color: rgba(0, 0, 0, 0.62);
}

.cue-text {
  min-width: 0;
  line-height: 1.45;
  word-break: break-word;
}

.cue-more,
.empty-state {
  font-size: 0.84rem;
  color: rgba(0, 0, 0, 0.62);
}

.cue-more {
  padding: 0.65rem 0.8rem;
}

.preview-empty {
  padding-top: 0.5rem;
}
</style>
