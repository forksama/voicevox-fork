<template>
  <QDialog v-model="modelValue" @beforeShow="initialize" @hide="cleanup">
    <QCard class="q-py-sm q-px-md portrait-picker-card">
      <QCardSection class="q-py-sm">
        <div class="text-h6">立絵を選択</div>
        <div class="text-caption text-warning">
          ⚠️ 立絵ディレクトリは GPT-SoVITS / VOICEVOX / UXP
          の三方で一致させてください
        </div>
      </QCardSection>

      <QSeparator />

      <QCardSection class="q-py-sm">
        <div class="row items-center q-gutter-sm">
          <QInput
            v-model="portraitDir"
            dense
            filled
            class="col"
            label="立絵ディレクトリ (基準)"
            @change="onPortraitDirChange"
          />
          <QBtn
            dense
            unelevated
            color="toolbar-button"
            textColor="toolbar-button-display"
            label="選択"
            @click="pickPortraitDir"
          />
        </div>
        <!-- 相対ディレクトリ: 手入力 (多階層可, 例 1.立絵/10 燐羽立絵) -->
        <QInput
          v-model="roleRelDir"
          dense
          filled
          clearable
          class="q-mt-sm"
          label="役割立絵相対ディレクトリ (立絵ディレクトリ基準, 多階層可)"
          placeholder="例: 1.立絵/10 燐羽立絵"
          @change="onRoleRelDirChange"
          @clear="onRoleRelDirClear"
        />
        <!-- パンくず: クリックでその階層へ戻る -->
        <div class="vpm-breadcrumb q-mt-xs">
          <span class="vpm-crumb" @click="navigateToDepth(-1)"
            >📁 (立絵ディレクトリ)</span
          >
          <template v-for="(seg, i) in relSegments" :key="i">
            <span class="vpm-crumb-sep">/</span>
            <span class="vpm-crumb" @click="navigateToDepth(i)">{{ seg }}</span>
          </template>
        </div>
        <!-- サブフォルダ: クリックで下階層へ進む -->
        <div v-if="currentSubDirs.length > 0" class="vpm-subdir-row q-mt-xs">
          <QChip
            v-for="dir in currentSubDirs"
            :key="dir"
            clickable
            dense
            icon="folder"
            color="toolbar-button"
            textColor="toolbar-button-display"
            @click="enterSubDir(dir)"
          >
            {{ dir }}
          </QChip>
        </div>
      </QCardSection>

      <QSeparator />

      <QCardSection class="portrait-grid-section scroll">
        <div v-if="loading" class="text-center q-pa-md text-grey">
          読み込み中...
        </div>
        <div
          v-else-if="thumbnails.length === 0"
          class="text-center q-pa-md text-grey"
        >
          画像がありません。立絵ディレクトリまたは相対ディレクトリを確認してください。
        </div>
        <div v-else class="portrait-grid">
          <div
            v-for="thumb in thumbnails"
            :key="thumb.absPath"
            class="portrait-thumb"
            :class="{ selected: thumb.absPath === selectedAbsPath }"
            :title="thumb.fileName"
            @click="selectThumb(thumb)"
          >
            <img :src="thumb.url" :alt="thumb.fileName" />
            <span class="portrait-thumb-label">{{ thumb.fileName }}</span>
          </div>
        </div>
      </QCardSection>

      <QSeparator />

      <QCardActions>
        <QSpace />
        <QBtn
          unelevated
          label="キャンセル"
          color="toolbar-button"
          textColor="toolbar-button-display"
          class="text-no-wrap text-bold q-mr-sm"
          @click="handleCancel"
        />
        <QBtn
          unelevated
          label="決定"
          color="toolbar-button"
          textColor="toolbar-button-display"
          class="text-no-wrap text-bold q-mr-sm"
          :disable="!selectedAbsPath"
          @click="handleConfirm"
        />
      </QCardActions>
    </QCard>
  </QDialog>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useStore } from "@/store";
import path from "@/helpers/path";
import { loadLocalImageObjectUrl } from "@/helpers/voicePortraitMapping";

const modelValue = defineModel<boolean>({ default: false });

const props = defineProps<{
  // 初期選択する立絵の絶対パス (再オープン時のハイライト用)
  initialPortraitPath?: string;
}>();

const emit = defineEmits<{
  // 決定時: 選択した立絵の絶対パスを返す
  (e: "confirm", portraitAbsPath: string): void;
}>();

const store = useStore();

type Thumbnail = {
  absPath: string;
  fileName: string;
  url: string;
};

const loading = ref(false);
const portraitDir = ref("");
const roleRelDir = ref("");
// 現在の相対ディレクトリ直下のサブフォルダ (逐階層ナビ用)
const currentSubDirs = ref<string[]>([]);
const thumbnails = ref<Thumbnail[]>([]);
const selectedAbsPath = ref("");

// 生成した object URL を解放するために保持
const objectUrls = ref<string[]>([]);

const savingSetting = computed(() => store.state.savingSetting);

// 相対ディレクトリをセグメント配列に (パンくず表示用)
const relSegments = computed(() =>
  roleRelDir.value ? roleRelDir.value.split("/").filter((s) => s !== "") : [],
);

function revokeUrls() {
  for (const url of objectUrls.value) {
    URL.revokeObjectURL(url);
  }
  objectUrls.value = [];
}

async function initialize() {
  // 設定から立絵ディレクトリを復元
  portraitDir.value = savingSetting.value.vpmPortraitDir ?? "";
  selectedAbsPath.value = props.initialPortraitPath ?? "";

  // 初期選択がある場合、その親フォルダを相対ディレクトリとして推定
  if (props.initialPortraitPath && portraitDir.value) {
    const parent = path.dirname(props.initialPortraitPath);
    const rel = path.relative(portraitDir.value, parent);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      roleRelDir.value = rel.split(path.SEPARATOR).join("/");
    } else {
      roleRelDir.value = "";
    }
  } else {
    roleRelDir.value = "";
  }

  await refreshCurrentFolder();
}

function cleanup() {
  revokeUrls();
  thumbnails.value = [];
}

/** 現在有効な立絵フォルダの絶対パス (立絵ディレクトリ + 相対ディレクトリ) */
const activeFolder = computed(() => {
  if (!portraitDir.value) return "";
  return roleRelDir.value
    ? path.join(portraitDir.value, roleRelDir.value)
    : portraitDir.value;
});

/** 現在の相対ディレクトリのサブフォルダと画像を同時に取得する。 */
async function refreshCurrentFolder() {
  revokeUrls();
  thumbnails.value = [];
  currentSubDirs.value = [];
  const folder = activeFolder.value;
  if (!folder) return;

  loading.value = true;
  try {
    const result = await window.backend.vpmListDirectory({ dirPath: folder });
    if (!result.ok) return;
    currentSubDirs.value = result.value.subDirs;

    const thumbs: Thumbnail[] = [];
    for (const fileName of result.value.imageFiles) {
      const absPath = path.join(folder, fileName);
      const url = await loadLocalImageObjectUrl(absPath);
      if (url) {
        objectUrls.value.push(url);
        thumbs.push({ absPath, fileName, url });
      }
    }
    thumbnails.value = thumbs;
  } finally {
    loading.value = false;
  }
}

/** サブフォルダに進む (相対ディレクトリに1階層追加)。 */
async function enterSubDir(dir: string) {
  roleRelDir.value = roleRelDir.value ? `${roleRelDir.value}/${dir}` : dir;
  await refreshCurrentFolder();
}

/**
 * パンくずの指定階層へ移動する。
 * depth = -1 で立絵ディレクトリ直下 (相対空), depth = i でセグメント i まで。
 */
async function navigateToDepth(depth: number) {
  if (depth < 0) {
    roleRelDir.value = "";
  } else {
    roleRelDir.value = relSegments.value.slice(0, depth + 1).join("/");
  }
  await refreshCurrentFolder();
}

async function onPortraitDirChange() {
  // 立絵ディレクトリを設定に保存
  await store.actions.SET_SAVING_SETTING({
    data: { ...savingSetting.value, vpmPortraitDir: portraitDir.value },
  });
  roleRelDir.value = "";
  await refreshCurrentFolder();
}

async function pickPortraitDir() {
  const dir = await window.backend.showOpenDirectoryDialog({
    title: "立絵ディレクトリを選択",
  });
  if (dir) {
    portraitDir.value = dir;
    await onPortraitDirChange();
  }
}

async function onRoleRelDirChange() {
  // 手入力の相対パスを正規化 (先頭/末尾のスラッシュ除去)
  roleRelDir.value = (roleRelDir.value ?? "")
    .split("/")
    .filter((s) => s !== "")
    .join("/");
  await refreshCurrentFolder();
}

async function onRoleRelDirClear() {
  roleRelDir.value = "";
  await refreshCurrentFolder();
}

function selectThumb(thumb: Thumbnail) {
  selectedAbsPath.value = thumb.absPath;
}

function handleCancel() {
  modelValue.value = false;
}

function handleConfirm() {
  if (!selectedAbsPath.value) return;
  emit("confirm", selectedAbsPath.value);
  modelValue.value = false;
}
</script>

<style scoped lang="scss">
.portrait-picker-card {
  min-width: 640px;
  max-width: 900px;
}

.vpm-breadcrumb {
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}

.vpm-crumb {
  cursor: pointer;
  text-decoration: underline;
  opacity: 0.85;

  &:hover {
    opacity: 1;
  }
}

.vpm-crumb-sep {
  opacity: 0.5;
}

.vpm-subdir-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 96px;
  overflow-y: auto;
}

.portrait-grid-section {
  max-height: 50vh;
}

.portrait-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.portrait-thumb {
  cursor: pointer;
  border: 3px solid transparent;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(0, 0, 0, 0.03);
  transition: border-color 0.15s;

  &:hover {
    border-color: rgba(0, 0, 0, 0.2);
  }

  &.selected {
    border-color: #2563eb;
  }

  img {
    width: 100%;
    height: 140px;
    object-fit: contain;
    background: #fff;
  }
}

.portrait-thumb-label {
  font-size: 10px;
  text-align: center;
  padding: 2px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
</style>
