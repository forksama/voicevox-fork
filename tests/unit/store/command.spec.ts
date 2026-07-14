import { beforeEach, expect, test } from "vitest";
import { store } from "@/store";
import type { State } from "@/store/type";
import { AudioKey, EngineId, SpeakerId, StyleId } from "@/type/preload";
import { resetMockMode, uuid4 } from "@/helpers/random";
import { cloneWithUnwrapProxy } from "@/helpers/cloneWithUnwrapProxy";

const initialState = cloneWithUnwrapProxy(store.state);
beforeEach(() => {
  store.replaceState(initialState);

  resetMockMode();
});

test("コマンド実行で履歴が作られる", async () => {
  await store.dispatch("COMMAND_SET_AUDIO_KEYS", {
    audioKeys: [AudioKey(uuid4())],
  });
  const { audioKeys, redoCommands, undoCommands } = store.state;
  expect({ audioKeys, redoCommands, undoCommands }).toMatchSnapshot();
});

test("書き出し番号を変更すると後続の番号も連番になる", async () => {
  const audioKeys = [AudioKey(uuid4()), AudioKey(uuid4()), AudioKey(uuid4())];
  const voice = {
    engineId: EngineId("074fc39e-678b-4c13-8916-ffca8d505d1d"),
    speakerId: SpeakerId("speaker-id"),
    styleId: StyleId(1),
  };
  const audioItems = Object.fromEntries(
    audioKeys.map((audioKey, index) => [
      audioKey,
      {
        text: `text${index}`,
        voice,
        exportFileNameIndex: index + 1,
      },
    ]),
  ) as State["audioItems"];
  const audioStates = Object.fromEntries(
    audioKeys.map((audioKey) => [audioKey, { nowGenerating: false }]),
  ) as State["audioStates"];

  store.replaceState({
    ...cloneWithUnwrapProxy(store.state),
    audioKeys,
    audioItems,
    audioStates,
  });

  await store.dispatch("COMMAND_SET_AUDIO_EXPORT_FILE_NAME_INDEX", {
    audioKey: audioKeys[1],
    exportFileNameIndex: 20,
  });

  expect(
    audioKeys.map(
      (audioKey) => store.state.audioItems[audioKey].exportFileNameIndex,
    ),
  ).toEqual([1, 20, 21]);
});
