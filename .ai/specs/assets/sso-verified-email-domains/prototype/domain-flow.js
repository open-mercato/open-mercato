(() => {
  const form = document.querySelector('#domain-form')
  const domain = document.querySelector('#email-domain')
  const error = document.querySelector('#domain-error')
  let pendingCheck

  function showScreen(id) {
    document.querySelector(`a[data-route-target="${id}"]`).click()
    const heading = document.querySelector(`#${id} .page-head h3`)
    heading.tabIndex = -1
    heading.focus({ preventScroll: true })
  }

  document.querySelectorAll('.screen-nav [data-goto]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      showScreen(link.dataset.goto)
    })
  })

  function showDomain(value) {
    document.querySelectorAll('[data-domain]').forEach((label) => { label.textContent = value })
    document.querySelectorAll('[data-record-name]').forEach((label) => {
      label.textContent = `_open-mercato-sso.${value}`
    })
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const value = domain.value.trim().toLowerCase()
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) {
      domain.setAttribute('aria-invalid', 'true')
      error.hidden = false
      domain.focus()
      return
    }
    domain.removeAttribute('aria-invalid')
    error.hidden = true
    showDomain(value)
    showScreen('s2')
  })

  document.querySelectorAll('[data-check]').forEach((button) => {
    button.addEventListener('click', () => {
      const wait = button.closest('.form-card').querySelector('[data-waiting]')
      button.disabled = true
      wait.hidden = false
      pendingCheck = window.setTimeout(() => {
        button.disabled = false
        wait.hidden = true
        showScreen(button.dataset.check === 'retry' ? 's4' : 's3')
      }, 250)
    })
  })

  const activate = document.querySelector('#s4 [data-activate]')
  const activeLabel = document.querySelector('#s4 [data-config-status]')
  const feedback = document.querySelector('#activation-feedback')
  activate.addEventListener('click', () => {
    activeLabel.textContent = 'Active'
    activate.disabled = true
    feedback.hidden = false
  })

  document.querySelector('#start-over').addEventListener('click', () => {
    window.clearTimeout(pendingCheck)
    form.reset()
    domain.removeAttribute('aria-invalid')
    error.hidden = true
    showDomain('northwind.example')
    activeLabel.textContent = 'Inactive'
    activate.disabled = false
    feedback.hidden = true
  })
})()
