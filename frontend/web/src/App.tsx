import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PlayerData {
  id: string;
  name: string;
  kda: number;
  encryptedKDA: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue?: number;
  publicValue1: number;
  publicValue2: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPlayer, setCreatingPlayer] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPlayerData, setNewPlayerData] = useState({ name: "", kda: "" });
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const playersList: PlayerData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          playersList.push({
            id: businessId,
            name: businessData.name,
            kda: Number(businessData.publicValue1) || 0,
            encryptedKDA: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading player data:', e);
        }
      }
      
      setPlayers(playersList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPlayer = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPlayer(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating player with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const kdaValue = parseInt(newPlayerData.kda) || 0;
      const businessId = `player-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, kdaValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPlayerData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        kdaValue,
        0,
        "Player KDA Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Player created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPlayerData({ name: "", kda: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPlayer(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "KDA decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready!" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredPlayers = players.filter(player =>
    player.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    const totalPlayers = players.length;
    const verifiedPlayers = players.filter(p => p.isVerified).length;
    const avgKDA = players.length > 0 
      ? players.reduce((sum, p) => sum + p.kda, 0) / players.length 
      : 0;

    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <div className="stat-value">{totalPlayers}</div>
            <div className="stat-label">Total Players</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{verifiedPlayers}</div>
            <div className="stat-label">Verified KDA</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{avgKDA.toFixed(1)}</div>
            <div className="stat-label">Avg KDA</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => (
    <div className="faq-section">
      <h3>FHE Matchmaking FAQ</h3>
      <div className="faq-list">
        <div className="faq-item">
          <div className="faq-question">What is FHE encryption?</div>
          <div className="faq-answer">Fully Homomorphic Encryption allows computations on encrypted data without decryption.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">How does it prevent smurfing?</div>
          <div className="faq-answer">KDA is encrypted and matched homomorphically, hiding true skill levels during matching.</div>
        </div>
        <div className="faq-item">
          <div className="faq-question">Is my data secure?</div>
          <div className="faq-answer">All sensitive data remains encrypted on-chain and is only decrypted locally.</div>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🎮 Private Matchmaking</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Join the privacy-first gaming matchmaking protocol powered by FHE encryption.</p>
            <div className="feature-list">
              <div className="feature">✓ Encrypted KDA matching</div>
              <div className="feature">✓ Anti-smurfing protection</div>
              <div className="feature">✓ Privacy-preserving gameplay</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="encryption-animation"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your gaming data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="encryption-animation"></div>
      <p>Loading matchmaking system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🎮 Private Matchmaking</h1>
          <span className="tagline">FHE-Powered Gaming</span>
        </div>
        
        <div className="header-actions">
          <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">
            {showFAQ ? "Close FAQ" : "FAQ"}
          </button>
          <button onClick={checkAvailability} className="check-btn">
            Check Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Add Player
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <main className="main-content">
        {showFAQ && renderFAQ()}
        
        <section className="dashboard-section">
          <h2>Player Statistics</h2>
          {renderStats()}
        </section>

        <section className="players-section">
          <div className="section-header">
            <h2>Registered Players</h2>
            <div className="controls">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search players..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="players-grid">
            {filteredPlayers.length === 0 ? (
              <div className="empty-state">
                <p>No players found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Add First Player
                </button>
              </div>
            ) : (
              filteredPlayers.map((player, index) => (
                <div 
                  key={player.id}
                  className={`player-card ${player.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedPlayer(player)}
                >
                  <div className="player-header">
                    <div className="player-name">{player.name}</div>
                    <div className="player-status">
                      {player.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </div>
                  </div>
                  <div className="player-info">
                    <div className="info-item">
                      <span>KDA:</span>
                      <span className="kda-value">
                        {player.isVerified ? player.decryptedValue : '🔒'}
                      </span>
                    </div>
                    <div className="info-item">
                      <span>Joined:</span>
                      <span>{new Date(player.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="player-actions">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPlayer(player);
                      }}
                      className="view-btn"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Add New Player</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Player Name</label>
                <input
                  type="text"
                  value={newPlayerData.name}
                  onChange={(e) => setNewPlayerData({...newPlayerData, name: e.target.value})}
                  placeholder="Enter player name"
                />
              </div>
              <div className="form-group">
                <label>KDA Score (Integer)</label>
                <input
                  type="number"
                  value={newPlayerData.kda}
                  onChange={(e) => setNewPlayerData({...newPlayerData, kda: e.target.value})}
                  placeholder="Enter KDA score"
                  min="0"
                  step="1"
                />
                <div className="hint">KDA will be encrypted with FHE</div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createPlayer} 
                disabled={creatingPlayer || isEncrypting || !newPlayerData.name || !newPlayerData.kda}
                className="submit-btn"
              >
                {creatingPlayer || isEncrypting ? "Encrypting..." : "Add Player"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPlayer && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Player Details</h2>
              <button onClick={() => setSelectedPlayer(null)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="player-detail">
                <div className="detail-item">
                  <label>Name:</label>
                  <span>{selectedPlayer.name}</span>
                </div>
                <div className="detail-item">
                  <label>KDA Status:</label>
                  <span className={`status ${selectedPlayer.isVerified ? 'verified' : 'encrypted'}`}>
                    {selectedPlayer.isVerified ? 
                      `Verified: ${selectedPlayer.decryptedValue}` : 
                      'Encrypted (FHE Protected)'
                    }
                  </span>
                </div>
                <div className="detail-item">
                  <label>Registered:</label>
                  <span>{new Date(selectedPlayer.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="detail-item">
                  <label>Creator:</label>
                  <span className="address">{selectedPlayer.creator}</span>
                </div>
              </div>
              
              <div className="action-section">
                <button 
                  onClick={async () => {
                    const result = await decryptData(selectedPlayer.id);
                    if (result !== null) {
                      setSelectedPlayer({...selectedPlayer, isVerified: true, decryptedValue: result});
                    }
                  }}
                  disabled={isDecrypting || selectedPlayer.isVerified}
                  className={`decrypt-btn ${selectedPlayer.isVerified ? 'verified' : ''}`}
                >
                  {isDecrypting ? 'Decrypting...' : 
                   selectedPlayer.isVerified ? '✅ Verified' : '🔓 Verify KDA'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

