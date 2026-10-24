import TopBoard from './components/TopBoard.jsx'
import SeeIt from './components/SeeIt.jsx'
import Tally from './components/Tally.jsx'
import RatingSteps from './components/RatingSteps.jsx'
import Footer from './components/Footer.jsx'

function App() {
  return (
    <>
      <TopBoard seeIt={<SeeIt />} />
      <Tally />
      <RatingSteps />
      <Footer />
    </>
  )
}

export default App
