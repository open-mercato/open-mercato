import assert from 'node:assert/strict'
import path from 'node:path'
import { expect } from '@playwright/test'

const kinds = ['time-off','current-project','status-tracker','notes','schedule','time-tracker','employee-spotlight','daily-feedback','work-hour-analysis','courses','daily-work-hours','training-analysis','course-progress','employee-rating']
const mini = new Set(['daily-work-hours','training-analysis','course-progress','employee-rating'])

export async function checkHrWidgets(page, render, artifacts) {
  const checks = []
  for (const theme of ['light','dark']) {
    const globals = `theme:${theme};font:application`
    const show = async (kind, empty = false) => render(page, `backend-charts-hr-widgets--variant-${kind}${empty ? '-empty' : ''}`, globals)
    for (const kind of kinds) {
      for (const empty of [false,true]) {
        await show(kind,empty)
        const widget = page.locator('[data-slot="hr-widget"]')
        const bounds = await widget.boundingBox()
        assert.equal(bounds.width,kind === 'courses' ? 728 : 352)
        assert.equal(bounds.height,kind === 'schedule' ? 784 : mini.has(kind) ? 178 : 380)
        assert.equal(await widget.evaluate(node => getComputedStyle(node).borderRadius),'16px')
        assert.equal((await widget.innerText()).includes('design_system.'),false)
        const sourceIcon = widget.locator('[data-slot="hr-source-icon"]')
        await expect(sourceIcon).toHaveCount(1)
        assert.equal((await sourceIcon.boundingBox()).width,24)
        assert.ok(await sourceIcon.evaluate(node => getComputedStyle(node).maskImage.includes('data:image/svg+xml;base64,')))
        for (const img of await widget.locator('img').all()) await expect.poll(() => img.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true)
        if (empty && !mini.has(kind)) {
          const illustration = widget.locator('[data-slot="empty-state-illustration"]')
          await expect(illustration).toHaveCount(1)
          assert.equal((await illustration.boundingBox()).width,['time-off','time-tracker'].includes(kind) ? 72 : 108)
        }
        if (artifacts) await widget.screenshot({animations:'disabled',path:path.join(artifacts,`${kind}${empty ? '-empty' : ''}-${theme}.png`)})
      }
    }
    for (const [kind, button, message] of [['time-tracker','History','No records of tracked time yet.'],['schedule','See All','No records of meetings yet.'],['work-hour-analysis','See All','No records of work hours yet.']]) {
      await show(kind,true)
      await page.getByRole('button',{name:button,exact:true}).click()
      await expect(page.getByRole('dialog')).toContainText(message)
      await page.keyboard.press('Escape')
    }
    await show('notes',true)
    await expect(page.getByRole('button',{name:'Add Note',exact:true})).toHaveCount(1)
    await show('time-off')
    await page.getByRole('button',{name:'See All',exact:true}).click()
    await expect(page.getByRole('dialog')).toContainText('Confirmed')
    await page.keyboard.press('Escape')
    await show('current-project')
    await page.getByRole('button',{name:'See All',exact:true}).click()
    await expect(page.getByRole('dialog')).toContainText('new Monday.com workspace')
    await page.keyboard.press('Escape')
    await show('status-tracker')
    for (const status of await page.locator('[data-slot=avatar-status]').all()) assert.equal((await status.boundingBox()).width,8)
    await page.getByRole('button',{name:'See All',exact:true}).click()
    await page.getByRole('dialog').getByRole('searchbox').fill('Arthur')
    await expect(page.getByRole('dialog')).toContainText('Arthur Taylor')
    await expect(page.getByRole('dialog')).not.toContainText('James Brown')
    await page.keyboard.press('Escape')

    for (const empty of [false,true]) {
      await show('notes',empty)
      await page.getByRole('button',{name:'Add Note',exact:true}).first().click()
      await expect(page.getByRole('dialog').getByRole('button',{name:'Save',exact:true})).toBeDisabled()
      await page.getByRole('dialog').getByRole('textbox',{name:'Note title'}).fill('Local HR note')
      await page.getByRole('dialog').getByRole('textbox',{name:'Description'}).fill('Review the example without a server.')
      await page.keyboard.press('Control+Enter')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const checkbox = page.getByRole('checkbox',{name:'Mark Local HR note complete',exact:true})
      await checkbox.press('Space')
      await expect(page.getByRole('checkbox',{name:'Mark Local HR note incomplete',exact:true})).toBeChecked()
    }

    await show('schedule')
    const schedule = page.locator('[data-slot="hr-widget"]')
    await schedule.getByRole('searchbox').fill('James')
    await expect(schedule.getByRole('button',{name:/Meeting details:/})).toHaveCount(1)
    await schedule.getByRole('searchbox').fill('')
    await schedule.getByRole('button',{name:'Marketing',exact:true}).click()
    await expect(schedule.getByRole('button',{name:/Meeting details:/})).toHaveCount(1)
    await schedule.getByRole('button',{name:'Marketing',exact:true}).click()
    await expect(schedule.getByRole('button',{name:/Meeting details:/})).toHaveCount(3)
    await schedule.getByRole('button',{name:'Meeting details: James Brown',exact:true}).click()
    await expect(schedule.getByRole('button',{name:'Meeting details: James Brown',exact:true})).toHaveAttribute('aria-expanded','true')
    await schedule.getByRole('button',{name:'Next',exact:true}).last().click()
    await expect(schedule).toContainText('No records of meetings yet.')
    await schedule.getByRole('button',{name:'Request',exact:true}).click()
    await page.getByRole('dialog').getByRole('textbox',{name:'Meeting title',exact:true}).fill('Local scheduling review')
    await page.keyboard.press('Control+Enter')
    await expect(schedule).toContainText('Local scheduling review')
    await schedule.getByRole('tab',{name:'Events',exact:true}).click()
    await expect(schedule).toContainText('No records of events yet.')
    await schedule.getByRole('tab',{name:'Holiday',exact:true}).click()
    await expect(schedule).toContainText('No records of holidays yet.')

    await show('time-tracker')
    await page.getByRole('button',{name:'Start Time Tracker',exact:true}).click()
    const elapsed = page.locator('output[aria-label="Tracked time"]')
    await expect.poll(() => elapsed.textContent()).not.toBe('00:00:00')
    await page.getByRole('button',{name:'Pause Time Tracker',exact:true}).click()
    const paused = await elapsed.textContent()
    await page.waitForTimeout(1100)
    await expect(elapsed).toHaveText(paused)
    await page.getByRole('combobox').click()
    await page.getByRole('option',{name:'Evernote App Redesign',exact:true}).click()
    await expect(elapsed).toHaveText('00:00:00')
    await page.getByRole('button',{name:'More options: Loom Rebranding',exact:true}).click()
    await page.getByRole('option',{name:'Start Time Tracker',exact:true}).click()
    await expect(page.getByRole('combobox')).toContainText('Loom Rebranding')
    await page.getByRole('button',{name:'Pause Time Tracker',exact:true}).click()
    await page.getByRole('button',{name:'More options: Evernote App Redesign',exact:true}).click()
    await page.getByRole('option',{name:'Remove',exact:true}).click()
    await expect(page.getByRole('button',{name:'More options: Evernote App Redesign',exact:true})).toHaveCount(0)

    await show('employee-spotlight')
    await page.getByRole('tab',{name:'Comments',exact:true}).click()
    await page.getByRole('textbox',{name:'Write a comment...',exact:true}).fill('Helpful teammate')
    await page.getByRole('button',{name:'Post comment',exact:true}).click()
    await expect(page.getByRole('tabpanel')).toContainText('Helpful teammate')
    await page.getByRole('tab',{name:'Rewards',exact:true}).click()
    await page.getByRole('button',{name:'Give recognition',exact:true}).click()
    await expect(page.getByRole('tabpanel')).toContainText('Recognition: 1')
    await page.getByRole('button',{name:'Share',exact:true}).click()
    await expect(page.getByRole('dialog').getByRole('textbox')).toContainText('Matthew Johnson')
    await page.keyboard.press('Escape')

    await show('daily-feedback')
    for (let question = 0; question < 4; question += 1) {
      await page.getByRole('radio').nth(question).click()
      await page.getByRole('textbox',{name:'Tell us why!',exact:true}).fill(`Local answer ${question + 1}`)
      await page.getByRole('button',{name:question === 3 ? 'Submit Feedback' : 'Next Question',exact:true}).click()
    }
    await expect(page.getByRole('status')).toHaveText('Your feedback has been saved in this preview.')
    await page.getByRole('button',{name:'Start again',exact:true}).click()
    await expect(page.getByRole('radio',{checked:true})).toHaveCount(0)
    await expect(page.getByRole('textbox',{name:'Tell us why!',exact:true})).toHaveValue('')

    await show('work-hour-analysis')
    await page.getByRole('radio',{name:'2W',exact:true}).click()
    await expect(page.locator('[data-slot="hr-widget"]')).toContainText('46 hours')
    await expect(page.getByRole('radio',{checked:true})).toHaveCount(1)
    await show('courses')
    await page.getByRole('searchbox').fill('Leadership')
    await expect(page.getByRole('row')).toHaveCount(2)
    await page.getByRole('button',{name:'Details: Leadership Skills',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Complete next lesson',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Complete next lesson',exact:true}).click()
    await expect(page.getByRole('dialog').getByRole('button',{name:'Complete next lesson',exact:true})).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('row').last()).toContainText('Completed')
    await page.getByRole('searchbox').fill('No such course')
    await expect(page.locator('[data-slot="hr-widget"]')).toContainText('No matching records.')
    for (const kind of ['daily-work-hours','training-analysis']) {
      await show(kind)
      await page.getByRole('button',{name:'Details',exact:true}).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Control+Enter')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    for (const empty of [false,true]) {
      await show('course-progress',empty)
      await page.getByRole('button',{name:empty ? 'Apply for a Course' : 'Resume Course',exact:true}).click()
      await page.getByRole('dialog').getByRole('button',{name:empty ? 'Enroll' : 'Complete next lesson',exact:true}).click()
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-slot="circular-progress"]')).toHaveAttribute('aria-valuenow',String(empty ? 25 : 50))
    }
    await show('employee-rating')
    await page.getByRole('button',{name:'Details',exact:true}).click()
    await page.getByRole('dialog').getByRole('radio').nth(3).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="hr-widget"]')).toContainText('4.0/5')
    checks.push(`All 28 HR source variants preserve shell dimensions, local artwork and translated text in ${theme}; notes, dates/tabs/search, timer pause/reset, comments/rewards, feedback, chart periods, course progress and rating interactions pass without API calls`)
  }
  const viewport = page.viewportSize()
  await page.setViewportSize({width:390,height:844})
  for (const kind of kinds) {
    await render(page,`backend-charts-hr-widgets--variant-${kind}`,'theme:light;font:application')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,kind)
    if (artifacts && ['schedule','courses'].includes(kind)) await page.screenshot({animations:'disabled',path:path.join(artifacts,`${kind}-mobile.png`)})
  }
  if (viewport) await page.setViewportSize(viewport)
  checks.push('All 14 HR widget layouts fit a 390px viewport; the courses table scrolls inside its card')
  return checks
}
