// 初遭遇の1行札（firstnotes.ts）。カタログの抜け＝「初出なのに札が出ない」を機械的に防ぐ
import { describe, expect, it } from 'vitest'
import { FIRST_NOTES, loadSeenNotes } from './firstnotes'
import { FLOORS } from './floors'

describe('初遭遇の1行札（firstnotes）', () => {
  it('全31層の原生種・課目タイプに札がある（初出がどの層に動いても文言を欠かさない）', () => {
    for (const f of FLOORS) {
      for (const e of f.enemies) expect(FIRST_NOTES[`enemy:${e.kind}`], `enemy:${e.kind}`).toBeTruthy()
      for (const g of f.goals) {
        const id = g.type === 'system' ? `goal:system:${g.system}` : `goal:${g.type}`
        expect(FIRST_NOTES[id], id).toBeTruthy()
      }
    }
  })

  it('特殊駒4種・兆候・灯ドレインの札がある', () => {
    for (const id of ['special:harpoon', 'special:hamushi', 'special:hitsubo', 'special:seiju', 'intent', 'oxygen-drain'])
      expect(FIRST_NOTES[id], id).toBeTruthy()
  })

  it('文言は1行札の体裁（「──」で名と記録を継ぎ、チュートリアル口調を含まない）', () => {
    for (const [id, text] of Object.entries(FIRST_NOTES)) {
      expect(text, id).toContain('──')
      expect(text, id).not.toMatch(/しよう|しましょう|してみよう|！/)
    }
  })

  it('localStorage の無い環境では既視集合が空に倒れる（クラッシュしない）', () => {
    expect(loadSeenNotes().size).toBe(0)
  })
})
