const express = require('express')
const app = express()
const port = 3000

app.use('/', express.static('www'))

app.listen(port, () => {
    console.log(`node api at http://localhost:${port}`)
})