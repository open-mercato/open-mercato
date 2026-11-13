import statusSuccess from './crypto-status-success.svg'
import statusPending from './crypto-status-pending.svg'
import statusWarning from './crypto-status-warning.svg'
import statusCancelled from './crypto-status-cancelled.svg'
import brand from './crypto-brand.png'
import phantom from './crypto-phantom.png'
import metamask from './crypto-metamask.png'
import walletconnect from './crypto-walletconnect.png'
import btc from './crypto-btc.png'
import eth from './crypto-eth.png'
import xrp from './crypto-xrp.png'
import usdt from './crypto-usdt.png'
import bnb from './crypto-bnb.png'
import sol from './crypto-sol.png'
import usdc from './crypto-usdc.png'
import trx from './crypto-trx.png'
import ada from './crypto-ada.png'
import avax from './crypto-avax.png'
import hbar from './crypto-hbar.png'
import dot from './crypto-dot.png'
import crown from './crypto-crown.svg'
import star from './crypto-star.svg'
import menu from './crypto-menu.svg'
import history from './crypto-history.svg'
import clock from './crypto-clock.svg'
import rewards from './crypto-rewards.svg'
import link from './crypto-link.svg'
import more from './crypto-more.svg'
import wei from './crypto-wei.png'
import sadFace from './crypto-sad-face.png'
const source = (image: string | { src: string }) => (typeof image === 'string' ? image : image.src)
export const cryptoArtwork = {
  statusSuccess: source(statusSuccess),
  statusPending: source(statusPending),
  statusWarning: source(statusWarning),
  statusCancelled: source(statusCancelled),
  brand: source(brand),
  phantom: source(phantom),
  metamask: source(metamask),
  walletconnect: source(walletconnect),
  btc: source(btc),
  eth: source(eth),
  xrp: source(xrp),
  usdt: source(usdt),
  bnb: source(bnb),
  sol: source(sol),
  usdc: source(usdc),
  trx: source(trx),
  ada: source(ada),
  avax: source(avax),
  hbar: source(hbar),
  dot: source(dot),
  crown: source(crown),
  star: source(star),
  menu: source(menu),
  history: source(history),
  clock: source(clock),
  rewards: source(rewards),
  link: source(link),
  more: source(more),
  wei: source(wei),
  sadFace: source(sadFace),
}
